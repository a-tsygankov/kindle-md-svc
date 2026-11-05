# Delivery options: desktop Send to Kindle investigation

Checked: 2026-11-04. This is a research result, not an implemented desktop adapter.

## Current Windows host

Send to Kindle was not detected in standard installed-app registry inventories,
Store packages, Start-menu apps, usual Amazon installation folders, Explorer
SendTo/context-menu registrations, App Paths, or printers. A nonstandard portable
copy cannot be ruled out. Other laptops/macOS hosts were not accessible for this
inspection. No software was installed or launched, and no document was submitted.

## What Amazon documents

[Amazon's current overview](https://digprjsurvey.amazon.co.uk/csad/help/node/G5WYD9SAF7PGXRNA)
lists Windows/macOS desktop applications, mobile Kindle apps, web upload and email.
It lists both EPUB and PDF as supported inputs. The desktop app submits documents
to the Amazon Kindle library; it is distinct from the reading application.

[Amazon's legacy PC page](https://images-na.ssl-images-amazon.com/images/G/01/kindle/merch/sendtokindle/stkLandingPagePC.html)
describes Explorer context-menu and virtual-printer integration. This page targets
old Windows versions; it is evidence of the interactive integration design, not
proof of current executable names, command-line flags, or unattended operation.

No documented official unattended-send CLI/API was found in the inspected Amazon
material. Current desktop download pages returned a bot challenge/503 during
research, and there is no installed build here to test. Passing a document to a
launcher must not be described as a successful upload without verifying behavior.

## Applicability to this service

| Path | Phone button behavior | Remaining interaction / requirement |
| --- | --- | --- |
| Host desktop adapter | Could ask the laptop to open a ready local export in an installed app, if that build accepts file launch | Unverified; may require Amazon login, device/library options and Send on the laptop. Requires an interactive host session. |
| Service SMTP | Existing backend can submit the export attachment from one authenticated phone action | Configure sender/provider credentials and approved Kindle recipient; SMTP submission does not prove Kindle delivery. |
| iPhone Kindle sharing | Download the export, then share it to the installed Kindle app | Uses iOS UI; browser-native file sharing also requires HTTPS and compatible file support. Not unattended. |
| Default mail client | Open an addressed message | Standard mailto cannot attach the export; attachment remains manual. |

Recommendation for a dependable phone-triggered, unattended submission: configure
the existing SMTP adapter. A desktop adapter is a possible optional **Open in Send
to Kindle** action, pending installation and a synthetic-file launch test; do not
claim single-action delivery or automate unseen confirmation dialogs by assumption.

If a desktop adapter is later implemented, configure/detect the executable per
host, pass only server-selected ready job artifacts, avoid shell interpolation,
and distinguish **opened in app** from **submitted** and **delivered**. Its UI may
appear on the laptop even when the request originates from the phone.

## Still unverified

- Current Windows/macOS app launch arguments and whether any supported build can
  submit without confirmation.
- Amazon account sign-in, actual upload, destination selection and Scribe import.
- Availability of this tool on other user laptops.

Mail-client recipient configuration remains implemented locally. Its dependent
mail-button workflow is still awaiting the user's choice; this investigation does
not silently replace that pending feature with a desktop sender.
