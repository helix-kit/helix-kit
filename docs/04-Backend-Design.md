API Contract:
    Backend Server (Gateway)
        
        - mTLS (Communication from Devices to Cloud)
        : HTTPS mTLS for device presigned URL generation
            Upload + Download Files + Update packages (OTA and Linux Packages)
        : HTTPS mTLS for event ingestion
        
        - Caddy Proxy for normal public HTTPs
        : HTTPS FileSystem Provider Storage Ingestion + Egression endpoints
        : CI pipeline signed url generation for package updates
        : CSR requests
        : Package Manifest Handling (Uploads, happening through CI)
            -> Linux Packages
            -> Embedded Binaries
            -> Appliance Packages (Packaged NextJS + Backend Codes)
        : Custom on demand firmware generation requests handling
            Delegates firmware generation to ESP IDF container image, post which uploads to storage system
        : WSS Server for Device <-> MQTT <-> UI interaction

        MQTT Event Ingestion, through Kafka Streaming

    NextJS Server
        
        - Presigned URLs for same storage provider, for UI use cases only.
        - Manages only UI side of things

    Workflow Orchestrator and Processor

        - Serves Inngest Functions for Workflow Engine on Cloud
        - Handles Cron Jobs
        - Ingests App Events through Kafka


Apps will send any workflow events to kafka, whether NextJS app, or Gateway for Device Events.
Workflow Orchestrator will inngest those events, and trigger Workflows based on Event Conditions.
    Conditions will be prechecked to not enqueue waste events only to be rejected later on.




Package Downloads:
    Profile based auto updates
        Devices will have profiles, could be anything, but profile manifest will declare the allowed package paths device can download (irrelevant of its version)
            Profiles for each device will be stored on cloud
                During presigned url generation, we will check device profile, and if it has the allowed path, then only allow the device to download it.
    Second option:
        User design their custom package, be it anything, then a versioned package for user basis is generated on backend
            That custom package will have its own set of IDs (1 ID per artifact)
                We will add the set of ID for each such custom package to device id, correlate them
                    Then device can download those custom packages also.
                        Now if user also updates the versions, then also devices will be able to download them.


    All boils down to device profile id only, if user designed a custom package, then also device profile will be updated.
        Or, instead of 1 device profile, devices can have multiple profiles
            Profile means group of artifacts, now that group can either have user defined custom packages, or ci generated artifacts.
                Each artifact has its ID


    1 Device <-> N Profiles
    1 Profile <-> N Artifacts

    CI also generate Artifacts based on ID and Versions
    User designed custom packages get new artifact ID, and put into new Profiles
