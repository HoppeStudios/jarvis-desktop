import { useState } from "react";
import type { TFunction } from "i18next";
import type { AppSettings } from "@pi-desktop/shared";
import { Badge, Button, SettingsToggle } from "../../../components/ui";
import { SettingsCard, SettingsRow } from "../primitives";
import { useAppStore } from "../../../stores/app-store";
import { liveVoiceApi } from "../../voice/live/live-voice-api";

export function JarvisSettings({ t, settings, saveSettings, activeCallId }: {
  t: TFunction;
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  activeCallId?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const showToast = useAppStore(state => state.showToast);
  const patch = async (value: Partial<AppSettings>) => {
    setSaving(true);
    try { await saveSettings(value); }
    catch { showToast(t("liveVoice.saveFailed"), { variant: "error" }); }
    finally { setSaving(false); }
  };
  const control = async (end = false) => {
    if (!end) setStarting(true);
    try {
      await liveVoiceApi.controlAutomation({ requestId: crypto.randomUUID(), action: end ? "end" : "start",
        ...(end ? { expectedCallId: activeCallId } : { freshCoordinator: true, initialMuted: false }) });
    } catch { showToast(t("liveVoice.callActionFailed"), { variant: "error" }); }
    finally { if (!end) setStarting(false); }
  };
  return <SettingsCard title="Jarvis">
    <SettingsRow title={t("liveVoice.jarvis.enable")} description={t("liveVoice.jarvis.enableDetail")}>
      <SettingsToggle checked={settings.jarvisEnabled === true} label={t("liveVoice.jarvis.enable")}
        busy={saving} onChange={() => void patch({ jarvisEnabled: !settings.jarvisEnabled })} />
    </SettingsRow>
    <SettingsRow title={t("liveVoice.jarvis.queue")} description={t("liveVoice.jarvis.queueDetail")}>
      <SettingsToggle checked={settings.jarvisQueueEnabled === true} label={t("liveVoice.jarvis.queue")}
        busy={saving} onChange={() => void patch({ jarvisQueueEnabled: !settings.jarvisQueueEnabled })} />
    </SettingsRow>
    <SettingsRow title={t("liveVoice.jarvis.coordinator")}>
      <Badge tone={activeCallId ? "success" : "neutral"}>{activeCallId ? t("liveVoice.jarvis.connected") : t("liveVoice.jarvis.idle")}</Badge>
      <Button variant="secondary" disabled={!settings.jarvisEnabled || !settings.liveVoice?.enabled || starting || Boolean(activeCallId)}
        onClick={() => void control()}>{starting ? t("common.loading") : t("liveVoice.jarvis.start")}</Button>
      <Button variant="ghost" disabled={!activeCallId && !starting} onClick={() => void control(true)}>{t("liveVoice.jarvis.end")}</Button>
    </SettingsRow>
    <SettingsRow title={t("liveVoice.jarvis.execution")} description={t("liveVoice.jarvis.effort")}>
      <span>GPT-6.1 Sol</span><Badge tone="success">Fast</Badge>
    </SettingsRow>
  </SettingsCard>;
}
