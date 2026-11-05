# Sleep investigation and proposed power policy

Checked: 2026-11-04. Policy below is proposed, not implemented. Windows power
settings were read but not changed. The pending mail-client choice remains deferred.

## Verified findings on this host

- Active plan: High performance. Sleep-after on AC: `0` (Never). On battery:
  `600` seconds (10 minutes). Hibernate-after is disabled for both power sources.
- Supported standby: S0 Low Power Idle, network connected (Modern Standby), plus
  hibernation. Conventional S3 sleep is unavailable on this host.
- `powercfg /requests` and `/waketimers` require an elevated terminal and failed
  in this session. Active blockers/wake timers have therefore not been verified.
  No elevation was attempted and no request overrides were installed.
- No explicit keep-awake calls were found in service/lifecycle code. No child
  conversion/browser process was running under the service at inspection time.
- The supervisor writes runtime heartbeat JSON on a 200 ms loop. Signed-in web
  clients poll jobs every 1.5 seconds, including when there is no work. These are
  unnecessary background activity; they are not proof of a Windows power request.

The AC Never setting alone explains the absence of automatic idle sleep; this
check does not prove that the service cannot additionally affect Modern Standby.

## Recommended policy

1. Set an ordinary Windows AC sleep timeout (for example, 30 minutes), leaving
   battery behavior and display/lid policies separately controlled by Windows.
   This is a host-wide change; it has not been applied by the service.
2. Keep the small HTTP listener available while the laptop is awake. Idle service
   operation should make no sleep-prevention request. Other applications/local
   user activity continue to be governed by Windows, without our service judging
   whether another application's work is important.
3. Start a renewable 30-minute activity lease only for deliberate web-app actions
   such as opening the authenticated workspace, browsing, converting or downloading.
   Auth checks, health probes, job polling, heartbeats and background tabs must not
   renew it. A merely forgotten tab must not keep the laptop awake indefinitely.
   Apply the idle grace on AC by default; on battery, protect only active jobs and
   let Windows apply its normal idle timeout afterward.
4. While queued/running conversions or submissions exist, protect active work from
   automatic idle sleep, with a bounded platform adapter. Release the request after
   work and the user activity lease expire. Respect manual Sleep/lid actions and
   allow the screen to turn off; never force the computer to sleep afterward.
5. Stop browsers/rendering processes after jobs, pause polling in hidden tabs,
   poll rapidly only for active jobs and otherwise refresh on action/focus. Reduce
   heartbeat writes to about every 5 seconds, with lifecycle checks aligned.
6. Resume/reconnect gracefully after Windows wakes. Jobs interrupted by manual
   sleep may need retry; never duplicate email submissions automatically.

If a complete process shutdown is preferred, an optional 30-minute idle exit can
wait for the queue to drain and use the existing graceful shutdown path. However,
the phone cannot reopen a stopped server. That mode needs a host shortcut, startup
task, or a separate small launcher; sleep protection and process shutdown should
be separate options. Likewise, a sleeping laptop is not reliably reachable just
because Modern Standby lists network connectivity.

## Diagnostic follow-up

In an elevated PowerShell, inspect `powercfg /requests` while idle, during a
synthetic conversion, and after stopping this service. On a Modern Standby host,
`powercfg /sleepstudy` can additionally help identify standby activity. These
commands may expose other application names; keep generated reports local.

After choosing a host sleep timeout and implementing the lease policy, verify
that idle polling does not renew the lease, conversions finish before graceful
idle exit, all power requests release on completion/failure/shutdown, and manual
sleep/resume does not produce false delivery claims.

Sources: [Microsoft powercfg reference](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options),
[Windows execution-state requests](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate).
