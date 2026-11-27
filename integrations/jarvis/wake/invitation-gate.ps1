# Native Live state determines whether another Jarvis call exists. A Discord or
# Windows audio session is not a Jarvis call and is never interrupted here.
function Get-JarvisInvitationBlockReason([hashtable]$Context) {
 if($Context.paused){return 'paused'}
 if(-not $Context.enabled){return 'disabled'}
 if($Context.active){return 'active-call'}
 if($Context.pendingWorkers -gt 0){return 'voice-control-pending'}
 if($Context.pendingCount -le 0){return 'no-pending-items'}
 if(-not $Context.pendingFingerprint){return 'queue-identity-unavailable'}
 if($Context.pendingFingerprint -ceq $Context.lastInvitedFingerprint){return 'unchanged-queue'}
 if($Context.nowMs-$Context.lastInvitation -lt $Context.cooldownMs){return 'cooldown'}
 if(-not $Context.unlocked){return 'locked'}
 if($Context.idleSeconds -ge $Context.returnIdleSeconds){return 'idle'}
 return $null
}
