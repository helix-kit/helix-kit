OS:

- Secure Shell Access
  - Login through cloud managed creds, no offline bypassing.
- Port Forwarding
- Remote shell from UI / helix cmdline
- SSH through port forwarding? TBD
- Files access based on same user permissions from UI // TBD
- Local ports also via cloud creds? => Cookies stored in browser, trusted by device backend, persisted for 7 days or like.. won't need login till then, but when required, cloud will grant login?

Logs storage and filtering and searching..?
Central postgres for apps?
  - Each app carries their own schemas and migrations.
  - Each app with postgres role and seperate database.
  - User with access to X app can get postgres creds for the particular DB the app uses.
  - Apps functionalities exposed over the same IPC/Websocket/MQTT bus


Remote VNC server.
UART debugging.

DB
    Persistent tables => Required for normal functioning of apps.
    Timeseries => Each app maybe storing events or something which might need cleanup to free up space on disk, and for backup purposes also.
File Storage => 
    Persistent => Stays on device always.
    Timeseries => Auto Cleanup, or move to offsite if older than X days.

    Like video clips or images can be cleaned up after X days to maintain space on device.


Secure config data storage? 
    Encrypted datastore key value pairs.
        Central common datastore for device level creds.
        App specific datastores for each app.


Device monitor service, with extension support for different types of devices.
    Store timeseries data on device
    
Why blot cloud database? Cloud can receive important events, rest of the data stored in device safely, and accessible through the UI services or users also has the access to the databases.





/dev/?


helix and root logins?
Grant access first, then if someone logged in as normal user, and have access, can elivate access directly. 
Let someone else who has helix or root access to it, generate a locked token for other person, but the actions will be noted, as both the token generators identity, and the accessor identity. Useful for support guys if they want to share the access to the dev team. 
Generator will select the users he want to give access to using the token? If he has given access, then the user will first login as the locked user, and then can elevate access.
If the locked user didn't had any prior access, but there is a token generated for him, he gets temporary access to the device till the duration of the token expires, and he can login as normal user till then. Once the token expires, only authorized users can login back as their normal identities.




PDF Reporting
Email Platform




