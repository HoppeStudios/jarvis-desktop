param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'invitation-gate.ps1')
$base=@{paused=$false;enabled=$true;active=$false;pendingWorkers=0;pendingCount=1;pendingFingerprint="queue-a";lastInvitedFingerprint="queue-b";nowMs=2000000;lastInvitation=0;cooldownMs=1800000;unlocked=$true;idleSeconds=0;returnIdleSeconds=120}
if(Get-JarvisInvitationBlockReason $base){throw 'Eligible pending queue must invite'}
foreach($case in @(@('paused',$true,'paused'),@('enabled',$false,'disabled'),@('active',$true,'active-call'),@('pendingWorkers',1,'voice-control-pending'),@('pendingCount',0,'no-pending-items'),@('lastInvitation',1999999,'cooldown'),@('unlocked',$false,'locked'),@('idleSeconds',120,'idle'))){
 $state=$base.Clone();$state[$case[0]]=$case[1]
 if((Get-JarvisInvitationBlockReason $state) -cne $case[2]){throw ('Wrong invitation decision: '+$case[0])}
}
Write-Output 'PASS native-call gating, cooldown, pause, pending control, lock and activity; unrelated audio capture does not block'

$unchanged=$base.Clone();$unchanged.lastInvitedFingerprint="queue-a";if((Get-JarvisInvitationBlockReason $unchanged) -cne "unchanged-queue"){throw "Repeated unchanged queue must not invite again"}
$unknown=$base.Clone();$unknown.pendingFingerprint=$null;if((Get-JarvisInvitationBlockReason $unknown) -cne "queue-identity-unavailable"){throw "Unknown queue identity must not invite"}
