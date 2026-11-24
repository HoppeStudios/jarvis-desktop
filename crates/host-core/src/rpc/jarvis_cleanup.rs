//! Private Main-to-Host cleanup, not a public session delete option.
use super::*;
use rusqlite::OptionalExtension;

// Compare every metadata column, including columns added in future migrations.
fn fingerprint(db: &crate::db::Database, id: &str) -> Result<Option<String>> {
    let mut query = db.conn().prepare("SELECT * FROM sessions WHERE id = ?1")?;
    let count = query.column_count();
    Ok(query.query_row([id], |row| {
        let values = (0..count)
            .map(|index| row.get::<_, rusqlite::types::Value>(index))
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(format!("{values:?}"))
    }).optional()?)
}

fn empty(st: &AppState, id: &str) -> Result<bool> {
    let eligible: bool = st.db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?1 AND title = 'Jarvis'
         AND source IS NULL AND deleted_at IS NULL AND pinned = 0
         AND last_seq = 0 AND todo_revision = 0 AND mode_snapshot_hash IS NULL)",
        [id], |row| row.get(0),
    )?;
    if !eligible || st.background_tasks.running_count_for(id) != 0
        || st.active_bash_cancellations.keys().any(|(session, _)| session == id)
        || st.active_tool_cancellations.keys().any(|(session, _, _)| session == id) {
        return Ok(false);
    }
    // Reject *any* dependent persisted data, not just user-message counts.
    // This also fails closed for new tables referencing sessions after upgrades.
    let tables = st.db.conn().prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )?.query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for table in tables {
        let quoted = format!("\"{}\"", table.replace('"', "\"\""));
        let foreign_keys = st.db.conn().prepare(&format!("PRAGMA foreign_key_list({quoted})"))?
            .query_map([], |row| Ok((row.get::<_, String>(2)?, row.get::<_, String>(3)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (parent, column) in foreign_keys {
            if parent != "sessions" { continue; }
            let column = format!("\"{}\"", column.replace('"', "\"\""));
            let present: bool = st.db.conn().query_row(
                &format!("SELECT EXISTS(SELECT 1 FROM {quoted} WHERE {column} = ?1)"),
                [id], |row| row.get(0),
            )?;
            if present { return Ok(false); }
        }
    }
    // Fresh coordinators have no transcript files. Do not use lossy readers:
    // torn, unknown, empty or inaccessible files are uncertainty, not emptiness.
    for path in [transcripts::transcript_path(&st.data_dir, id)?,
        transcripts::revisions_path(&st.data_dir, id)?,
        transcripts::inflight_path(&st.data_dir, id)?,
        scratch::session_dir(&st.data_dir, id).ok_or_else(|| anyhow!("invalid scratch owner"))?,
        visualizations::session_dir(&st.data_dir, id).ok_or_else(|| anyhow!("invalid visualization owner"))?,
        review::session_review_dir(&st.data_dir, id)?] {
        match std::fs::symlink_metadata(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(error.into()),
            Ok(_) => return Ok(false),
        }
    }
    Ok(true)
}

pub(super) fn arm(st: &mut AppState, id: &str, capability: &str) -> Result<bool> {
    // Ephemeral provenance: never recover ownership from a title after restart.
    if st.jarvis_cleanup_owners.contains_key(id) || !empty(st, id)? { return Ok(false); }
    if st.jarvis_cleanup_owners.len() >= 64 {
        if let Some(oldest) = st.jarvis_cleanup_owners.keys().next().cloned() {
            st.jarvis_cleanup_owners.remove(&oldest);
        }
    }
    let Some(snapshot) = fingerprint(&st.db, id)? else { return Ok(false); };
    st.jarvis_cleanup_owners.insert(id.to_string(), (capability.to_string(), snapshot));
    Ok(true)
}

pub(super) fn delete_empty(st: &mut AppState, id: &str, capability: &str) -> Result<bool> {
    let Some((owned_capability, snapshot)) = st.jarvis_cleanup_owners.get(id) else { return Ok(false); };
    if owned_capability != capability { return Ok(false); }
    let snapshot = snapshot.clone();
    st.jarvis_cleanup_owners.remove(id);
    // The RPC keeps AppState locked throughout the predicate and transaction.
    // All normal turn, queue and transcript writers take this same mutex.
    let tx = st.db.conn().unchecked_transaction()?;
    if !empty(st, id)? || fingerprint(&st.db, id)?.as_deref() != Some(&snapshot) {
        return Ok(false);
    }
    let deleted = st.db.conn().execute("DELETE FROM sessions WHERE id = ?1", [id])? == 1;
    tx.commit()?;
    if deleted { drop_session_side_data(st, id); }
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coordinator(st: &AppState) -> String {
        sessions::create_session(&st.db, Some("Jarvis".into()), None, None, None, None).unwrap().id
    }

    #[test]
    fn only_owned_empty_coordinator_is_deleted_and_unrelated_history_is_retained() {
        let dir = tempfile::tempdir().unwrap();
        let mut st = AppState::open(dir.path()).unwrap();
        let owned = coordinator(&st);
        let unrelated = coordinator(&st);
        let turn = sessions::begin_turn(&st.db, &unrelated, None, None).unwrap();
        assert!(arm(&mut st, &owned, "capability").unwrap());
        assert!(!delete_empty(&mut st, &unrelated, "capability").unwrap());
        assert!(!delete_empty(&mut st, &owned, "wrong-capability").unwrap());
        assert!(delete_empty(&mut st, &owned, "capability").unwrap());
        assert!(!sessions::session_exists(&st.db, &owned).unwrap());
        assert!(sessions::session_exists(&st.db, &unrelated).unwrap());
        let retained: String = st.db.conn().query_row("SELECT id FROM turns WHERE session_id = ?1", [&unrelated], |row| row.get(0)).unwrap();
        assert_eq!(retained, turn);
        assert!(!delete_empty(&mut st, &owned, "capability").unwrap());
    }

    #[test]
    fn metadata_edits_active_work_queued_input_and_unknown_files_preserve_session() {
        for mutation in ["rename", "turn", "queued", "message", "file", "scratch", "review", "visualization", "todo", "new-relation"] {
            let dir = tempfile::tempdir().unwrap();
            let mut st = AppState::open(dir.path()).unwrap();
            let id = coordinator(&st);
            assert!(arm(&mut st, &id, "capability").unwrap());
            match mutation {
                "rename" => { sessions::rename_session(&st.db, &id, "User title").unwrap(); },
                "turn" => { sessions::begin_turn(&st.db, &id, None, None).unwrap(); },
                "queued" => {
                    let input = serde_json::from_value(json!({"sessionId":id,"principal":"fixture","inputHash":"fixture", "content":"fixture queued input", "permissionMode":"ask"})).unwrap();
                    turn_queue::push(&st.db, input).unwrap();
                },
                "message" => {
                    st.db.conn().execute("INSERT INTO messages (id, session_id, seq, role, text, created_at) VALUES ('fixture', ?1, 1, 'user', 'fixture text', 1)", [&id]).unwrap();
                },
                "file" => {
                    let path = transcripts::inflight_path(&st.data_dir, &id).unwrap();
                    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                    std::fs::write(path, "torn fixture checkpoint").unwrap();
                },
                "scratch" | "review" | "visualization" => {
                    let path = match mutation {
                        "scratch" => scratch::session_dir(&st.data_dir, &id).unwrap(),
                        "review" => review::session_review_dir(&st.data_dir, &id).unwrap(),
                        _ => visualizations::session_dir(&st.data_dir, &id).unwrap(),
                    };
                    std::fs::create_dir_all(&path).unwrap();
                    std::fs::write(path.join("fixture.txt"), "fixture attachment or edit state").unwrap();
                },
                "todo" => { st.db.conn().execute("UPDATE sessions SET todo_revision = 1 WHERE id = ?1", [&id]).unwrap(); },
                "new-relation" => {
                    st.db.conn().execute_batch("CREATE TABLE future_session_data(session_id TEXT REFERENCES sessions(id));").unwrap();
                    st.db.conn().execute("INSERT INTO future_session_data VALUES (?1)", [&id]).unwrap();
                },
                _ => unreachable!(),
            }
            assert!(!delete_empty(&mut st, &id, "capability").unwrap(), "{mutation}");
            assert!(sessions::session_exists(&st.db, &id).unwrap(), "{mutation}");
        }
    }

    #[tokio::test]
    async fn rpc_rejects_caller_empty_boolean_and_rechecks_after_lock_admission() {
        let dir = tempfile::tempdir().unwrap();
        let mut st = AppState::open(dir.path()).unwrap();
        st.handshook = true;
        let id = coordinator(&st);
        let capability = uuid::Uuid::new_v4().to_string();
        let state = Arc::new(Mutex::new(st));
        let (tx, _rx) = mpsc::unbounded_channel();
        let params = json!({ "id": id, "capability": capability });
        let armed = handle_request(state.clone(), "jarvis.coordinator.arm", params.clone(), tx.clone()).await.unwrap();
        assert_eq!(armed["ok"], true);
        let mut invalid = params.clone();
        invalid["empty"] = json!(true);
        assert!(handle_request(state.clone(), "jarvis.coordinator.deleteEmpty", invalid, tx.clone()).await.is_err());
        let guard = state.lock().await;
        let deleting_state = state.clone();
        let deleting = tokio::spawn(async move {
            handle_request(deleting_state, "jarvis.coordinator.deleteEmpty", params, tx).await
        });
        // This turn wins the authoritative lock even though deletion was requested.
        sessions::begin_turn(&guard.db, &id, None, None).unwrap();
        drop(guard);
        assert_eq!(deleting.await.unwrap().unwrap()["ok"], false);
        assert!(sessions::session_exists(&state.lock().await.db, &id).unwrap());
    }
}
