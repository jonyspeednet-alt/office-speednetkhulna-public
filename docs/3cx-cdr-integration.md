# 3CX Call Details Integration

The support portal can receive 3CX CDR records over TCP and correlate them to
recent 3CX dialer handoffs. The receiver is **disabled by default**. It stores
call IDs, ticket/user association when matched, extension, numbers, timestamps,
duration, and termination reason. Audio recordings are not transferred by CDR.

## Network and receiver setup

Only enable this after confirming the PBX can route to the office server over a
private network or VPN. Do not expose the raw CDR TCP listener to the public
Internet. Configure the receiver on the office server with these environment
variables (keep them in the server's ignored environment configuration):

```text
THREECX_CDR_ENABLED=true
THREECX_CDR_HOST=${PRIVATE_SERVER_BIND_IP}
THREECX_CDR_PORT=${PRIVATE_CDR_PORT}
THREECX_CDR_ALLOWED_IPS=${PRIVATE_PBX_IP}
THREECX_CDR_TIMEZONE=Asia/Dhaka
THREECX_CDR_FIELDS=historyid,callid,duration,time-start,time-answered,time-end,reason-terminated,from-no,to-no,dial-no,from-dn,to-dn
```

The bind address must be a private IPv4 address and every PBX source address
must be listed in `THREECX_CDR_ALLOWED_IPS`. Configure the firewall to allow
only that PBX to connect to the chosen TCP port. If there are multiple PBXs,
allowlist each private address and make sure every PBX sends the same configured
field order. Restart the API after changing environment variables.

## 3CX configuration

In the 3CX Admin Console, enable CDR under **Admin → Advanced → CDR** and use
the active/client socket output to connect to the private server address and
port above. Configure the output fields in exactly the order specified in
`THREECX_CDR_FIELDS`; records must be comma-separated CSV lines. Confirm that
the configured output includes `historyid`, `callid`, and `time-start`.

The built-in phone-directory extension assignments should be kept current.
For calls initiated from the support ticket buttons, the portal account that
clicked is also retained; the extension is taken from the CDR `from-dn` field.
The portal reads each user's assigned extension from the existing phone
directory and matches that extension (when available), destination number, and
call start time (within two minutes). A CDR row that cannot be matched is
retained as an unlinked call in `support_3cx_calls`.

## Recordings

Recording availability and retrieval are separate from CDR. Enable recording
and configure a supported remote archive in 3CX before adding secure recording
links to the portal. Do not place audio bytes or recording credentials in CDR
fields or ticket event metadata. The portal currently stores call metadata
only; authenticated playback requires a separate storage/access integration.

See [3CX CDR documentation](https://www.3cx.com/docs/cdr-call-data-records/)
and [3CX recording configuration](https://www.3cx.com/docs/manual/call-recording/).
