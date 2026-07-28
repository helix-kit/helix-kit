# TRPC Procedure Usage

Total procedures: 66
Used procedures: 60
Ignored procedures: 0
Unused procedures: 6

## Procedures

| Procedure | Kind | OpenAPI Route | Status | Uses | Root Surface | Defined At | Usage Locations |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| blog.create | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/blog/router.ts:267:5 | apps/helix/src/app/admin/(dashboard)/create-post-button.tsx:14:5 (mutationOptions) |
| blog.delete | mutation |  | used | 2 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/blog/router.ts:315:5 | apps/helix/src/app/admin/(dashboard)/post/[id]/page.tsx:53:5 (mutationOptions)<br>apps/helix/src/app/admin/(dashboard)/posts-table.tsx:31:5 (mutationOptions) |
| blog.getById | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/blog/router.ts:262:5 | apps/helix/src/app/admin/(dashboard)/post/[id]/page.tsx:49:5 (queryOptions) |
| blog.list | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/blog/router.ts:210:5 | apps/helix/src/app/admin/(dashboard)/page.tsx:13:58 (queryOptions) |
| blog.update | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/blog/router.ts:287:5 | apps/helix/src/app/admin/(dashboard)/post/[id]/page.tsx:51:43 (mutationOptions) |
| countPublished | query |  | unused | 0 | apps/helix/src/server/trpc.ts:124:32 | packages/core/helix-backend/src/blog/router.ts:115:5 |  |
| deviceCertificates.list | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/pki/admin-router.ts:51:5 | apps/helix/src/app/device/[id]/device-certificates.tsx:46:8 (queryOptions) |
| deviceCertificates.revoke | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/pki/admin-router.ts:81:5 | apps/helix/src/app/device/[id]/device-certificates.tsx:50:5 (mutationOptions) |
| devices.create | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/devices/admin-router.ts:162:5 | apps/helix/src/app/admin/(dashboard)/devices/devices-table.tsx:102:43 (mutationOptions) |
| devices.delete | mutation |  | used | 2 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/devices/admin-router.ts:208:5 | apps/helix/src/app/admin/(dashboard)/devices/devices-table.tsx:159:5 (mutationOptions)<br>apps/helix/src/app/device/[id]/device-actions.tsx:44:5 (mutationOptions) |
| devices.events | query |  | unused | 0 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/devices/admin-router.ts:216:5 |  |
| devices.get | query |  | used | 2 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/devices/admin-router.ts:134:5 | apps/helix/src/app/device/[id]/[app]/page.tsx:22:45 (queryOptions)<br>apps/helix/src/app/device/[id]/page.tsx:28:45 (queryOptions) |
| devices.list | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/devices/admin-router.ts:59:5 | apps/helix/src/app/admin/(dashboard)/devices/page.tsx:12:58 (queryOptions) |
| devices.rotateToken | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/devices/admin-router.ts:193:5 | apps/helix/src/app/admin/(dashboard)/devices/devices-table.tsx:150:5 (mutationOptions) |
| devices.setActive | mutation |  | used | 2 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/devices/admin-router.ts:182:5 | apps/helix/src/app/admin/(dashboard)/devices/devices-table.tsx:141:5 (mutationOptions)<br>apps/helix/src/app/device/[id]/device-actions.tsx:35:5 (mutationOptions) |
| espFlasher.getFirmwares | query |  | unused | 0 | apps/helix/src/server/trpc.ts:66:26 | packages/core/device-apps/src/esp32-flasher/router.ts:22:5 |  |
| features.catalog | query |  | unused | 0 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/features/admin-router.ts:33:5 |  |
| features.deviceOverrides | query |  | unused | 0 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/features/admin-router.ts:76:5 |  |
| features.profileFeatures | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/features/admin-router.ts:38:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/features-panel.tsx:18:42 (queryOptions) |
| features.resolveDevice | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/features/admin-router.ts:127:5 | apps/helix/src/app/device/[id]/device-feature-overrides.tsx:36:8 (queryOptions) |
| features.setDeviceOverride | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/features/admin-router.ts:91:5 | apps/helix/src/app/device/[id]/device-feature-overrides.tsx:40:5 (mutationOptions) |
| features.setProfileFeature | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/features/admin-router.ts:54:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/features-panel.tsx:20:5 (mutationOptions) |
| file.createDeviceDownloadSession | mutation | POST /api/storage/devices/download-session | used | 1 | apps/helix-server/src/roles/gateway.ts:84:13 | packages/core/helix-backend/src/device-mtls/fileRouter.ts:66:5 | packages/core/helix-backend/src/device-mtls/fileRouter.ts:67:49 (openapi-path) |
| file.createDeviceUploadSession | mutation | POST /api/storage/devices/upload-session | used | 1 | apps/helix-server/src/roles/gateway.ts:84:13 | packages/core/helix-backend/src/device-mtls/fileRouter.ts:75:5 | packages/core/helix-backend/src/device-mtls/fileRouter.ts:76:49 (openapi-path) |
| file.createPackageDownloadSession | mutation | POST /api/storage/packages/download-session | used | 2 | apps/helix-server/src/roles/gateway.ts:84:13 | packages/core/helix-backend/src/device-mtls/fileRouter.ts:85:5 | ../tests/e2e/test_releases_ota.py:44:72 (openapi-path)<br>packages/core/helix-backend/src/device-mtls/fileRouter.ts:86:49 (openapi-path) |
| file.ingestEvents | mutation | POST /api/device/events | used | 4 | apps/helix-server/src/roles/gateway.ts:84:13 | packages/core/helix-backend/src/device-mtls/fileRouter.ts:107:5 | ../tests/e2e/_events.py:68:72 (openapi-path)<br>../tests/e2e/test_device_http_events.py:22:35 (openapi-path)<br>../tooling/loadtest/remote_harness.py:15:54 (openapi-path)<br>packages/core/helix-backend/src/device-mtls/fileRouter.ts:108:49 (openapi-path) |
| getBySlug | query |  | used | 2 | apps/helix/src/server/trpc.ts:124:32 | packages/core/helix-backend/src/blog/router.ts:137:5 | apps/helix/src/app/(marketing)/blog/[slug]/page.tsx:26:24 (direct-call)<br>apps/helix/src/app/(marketing)/blog/[slug]/page.tsx:42:22 (direct-call) |
| getRelated | query |  | used | 1 | apps/helix/src/server/trpc.ts:124:32 | packages/core/helix-backend/src/blog/router.ts:160:5 | apps/helix/src/app/(marketing)/blog/[slug]/page.tsx:45:26 (direct-call) |
| ice.config | query |  | unused | 0 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/ice/index.ts:76:5 |  |
| listPublished | query |  | used | 1 | apps/helix/src/server/trpc.ts:124:32 | packages/core/helix-backend/src/blog/router.ts:92:5 | apps/helix/src/app/(marketing)/blog/page.tsx:17:19 (direct-call) |
| pki.issueDeviceCertificate | mutation | POST /api/certificates/device | used | 5 | apps/helix-server/src/roles/gateway.ts:109:21 | packages/core/helix-backend/src/pki/router.ts:42:5 | ../tests/e2e/conftest.py:106:21 (openapi-path)<br>../tests/e2e/test_cert_provisioning.py:36:21 (openapi-path)<br>../tooling/loadtest/certs.py:23:21 (openapi-path)<br>../tooling/loadtest/provision_remote.py:7:22 (openapi-path)<br>packages/core/helix-backend/src/pki/router.ts:46:18 (openapi-path) |
| profiles.addTrack | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:189:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/track-dialog.tsx:108:40 (mutationOptions) |
| profiles.assignDevice | mutation |  | used | 2 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:284:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/devices-panel.tsx:47:5 (mutationOptions)<br>apps/helix/src/app/device/[id]/device-profiles.tsx:76:5 (mutationOptions) |
| profiles.create | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:144:5 | apps/helix/src/app/admin/(dashboard)/profiles/profiles-table.tsx:39:43 (mutationOptions) |
| profiles.delete | mutation |  | used | 2 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:181:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/profile-header-actions.tsx:30:5 (mutationOptions)<br>apps/helix/src/app/admin/(dashboard)/profiles/profiles-table.tsx:67:5 (mutationOptions) |
| profiles.deviceProfiles | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:333:5 | apps/helix/src/app/device/[id]/device-profiles.tsx:127:8 (queryOptions) |
| profiles.deviceSearch | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:310:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/devices-panel.tsx:43:8 (queryOptions) |
| profiles.get | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:124:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/page.tsx:17:26 (queryOptions) |
| profiles.list | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:57:5 | apps/helix/src/app/admin/(dashboard)/profiles/page.tsx:12:58 (queryOptions) |
| profiles.profileSearch | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:349:5 | apps/helix/src/app/device/[id]/device-profiles.tsx:72:8 (queryOptions) |
| profiles.removeTrack | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:238:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/tracks-panel.tsx:69:5 (mutationOptions) |
| profiles.resolveDevice | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:373:5 | apps/helix/src/app/device/[id]/device-profiles.tsx:131:8 (queryOptions) |
| profiles.trackOptions | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:247:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/page.tsx:18:26 (queryOptions) |
| profiles.unassignDevice | mutation |  | used | 2 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:294:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/devices-panel.tsx:99:5 (mutationOptions)<br>apps/helix/src/app/device/[id]/device-profiles.tsx:135:5 (mutationOptions) |
| profiles.update | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:162:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/profile-header-actions.tsx:28:43 (mutationOptions) |
| profiles.updateTrack | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/profiles/admin-router.ts:217:5 | apps/helix/src/app/admin/(dashboard)/profiles/[id]/track-dialog.tsx:109:41 (mutationOptions) |
| publishedSlugs | query |  | used | 1 | apps/helix/src/server/trpc.ts:124:32 | packages/core/helix-backend/src/blog/router.ts:129:5 | apps/helix/src/app/sitemap.ts:28:27 (direct-call) |
| releases.buildArtifactUrl | mutation | POST /api/build/artifact-url | used | 2 | apps/helix-server/src/roles/gateway.ts:109:21 | packages/core/helix-backend/src/releases/api-router.ts:253:5 | ../tooling/release/sim.py:171:14 (openapi-path)<br>packages/core/helix-backend/src/releases/api-router.ts:254:49 (openapi-path) |
| releases.buildComplete | mutation | POST /api/build/complete | used | 2 | apps/helix-server/src/roles/gateway.ts:109:21 | packages/core/helix-backend/src/releases/api-router.ts:269:5 | ../tooling/release/sim.py:185:14 (openapi-path)<br>packages/core/helix-backend/src/releases/api-router.ts:270:49 (openapi-path) |
| releases.builds.filterOptions | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/releases/admin-router.ts:448:7 | apps/helix/src/app/admin/(dashboard)/builds/page.tsx:14:26 (queryOptions) |
| releases.builds.list | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/releases/admin-router.ts:397:7 | apps/helix/src/app/admin/(dashboard)/builds/page.tsx:13:26 (queryOptions) |
| releases.buildsRequest | mutation | POST /api/builds/request | used | 2 | apps/helix-server/src/roles/gateway.ts:109:21 | packages/core/helix-backend/src/releases/api-router.ts:181:5 | ../tooling/release/sim.py:158:14 (openapi-path)<br>packages/core/helix-backend/src/releases/api-router.ts:182:49 (openapi-path) |
| releases.ciArtifactUploadUrl | mutation | POST /api/ci/artifacts/upload-url | used | 2 | apps/helix-server/src/roles/gateway.ts:109:21 | packages/core/helix-backend/src/releases/api-router.ts:148:5 | ../tooling/release/sim.py:201:18 (openapi-path)<br>packages/core/helix-backend/src/releases/api-router.ts:149:49 (openapi-path) |
| releases.ciRegisterRelease | mutation | POST /api/ci/releases | used | 2 | apps/helix-server/src/roles/gateway.ts:109:21 | packages/core/helix-backend/src/releases/api-router.ts:164:5 | ../tooling/release/sim.py:226:14 (openapi-path)<br>packages/core/helix-backend/src/releases/api-router.ts:165:49 (openapi-path) |
| releases.filterOptions | query |  | used | 2 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/releases/admin-router.ts:169:5 | apps/helix/src/app/admin/(dashboard)/products/page.tsx:14:26 (queryOptions)<br>apps/helix/src/app/admin/(dashboard)/releases/page.tsx:14:26 (queryOptions) |
| releases.getById | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/releases/admin-router.ts:183:5 | apps/helix/src/app/admin/(dashboard)/releases/[id]/page.tsx:127:45 (queryOptions) |
| releases.list | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/releases/admin-router.ts:140:5 | apps/helix/src/app/admin/(dashboard)/releases/page.tsx:13:26 (queryOptions) |
| releases.otaTrigger | mutation | POST /api/ota/trigger | used | 2 | apps/helix-server/src/roles/gateway.ts:109:21 | packages/core/helix-backend/src/releases/api-router.ts:319:5 | ../tooling/release/sim.py:374:28 (openapi-path)<br>packages/core/helix-backend/src/releases/api-router.ts:320:49 (openapi-path) |
| releases.products.get | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/releases/admin-router.ts:313:7 | apps/helix/src/app/admin/(dashboard)/products/[typeKey]/[name]/page.tsx:30:26 (queryOptions) |
| releases.products.list | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/releases/admin-router.ts:239:7 | apps/helix/src/app/admin/(dashboard)/products/page.tsx:13:26 (queryOptions) |
| releases.products.releases | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/releases/admin-router.ts:373:7 | apps/helix/src/app/admin/(dashboard)/products/[typeKey]/[name]/page.tsx:32:7 (queryOptions) |
| users.filterOptions | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/users/admin-router.ts:127:5 | apps/helix/src/app/admin/(dashboard)/users/page.tsx:17:26 (queryOptions) |
| users.list | query |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/users/admin-router.ts:47:5 | apps/helix/src/app/admin/(dashboard)/users/page.tsx:16:26 (queryOptions) |
| users.remove | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/users/admin-router.ts:174:5 | apps/helix/src/app/admin/(dashboard)/users/users-table.tsx:94:5 (mutationOptions) |
| users.setBan | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/users/admin-router.ts:146:5 | apps/helix/src/app/admin/(dashboard)/users/users-table.tsx:88:5 (mutationOptions) |
| users.setRole | mutation |  | used | 1 | apps/helix/src/server/trpc.ts:66:26 | packages/core/helix-backend/src/users/admin-router.ts:138:5 | apps/helix/src/app/admin/(dashboard)/users/users-table.tsx:85:5 (mutationOptions) |

## OpenAPI Usages

| Procedure | OpenAPI Route | Direct HTTP Usage Locations |
| --- | --- | --- |
| file.createDeviceDownloadSession | POST /api/storage/devices/download-session | packages/core/helix-backend/src/device-mtls/fileRouter.ts:67:49 |
| file.createDeviceUploadSession | POST /api/storage/devices/upload-session | packages/core/helix-backend/src/device-mtls/fileRouter.ts:76:49 |
| file.createPackageDownloadSession | POST /api/storage/packages/download-session | ../tests/e2e/test_releases_ota.py:44:72<br>packages/core/helix-backend/src/device-mtls/fileRouter.ts:86:49 |
| file.ingestEvents | POST /api/device/events | ../tests/e2e/_events.py:68:72<br>../tests/e2e/test_device_http_events.py:22:35<br>../tooling/loadtest/remote_harness.py:15:54<br>packages/core/helix-backend/src/device-mtls/fileRouter.ts:108:49 |
| pki.issueDeviceCertificate | POST /api/certificates/device | ../tests/e2e/conftest.py:106:21<br>../tests/e2e/test_cert_provisioning.py:36:21<br>../tooling/loadtest/certs.py:23:21<br>../tooling/loadtest/provision_remote.py:7:22<br>packages/core/helix-backend/src/pki/router.ts:46:18 |
| releases.buildArtifactUrl | POST /api/build/artifact-url | ../tooling/release/sim.py:171:14<br>packages/core/helix-backend/src/releases/api-router.ts:254:49 |
| releases.buildComplete | POST /api/build/complete | ../tooling/release/sim.py:185:14<br>packages/core/helix-backend/src/releases/api-router.ts:270:49 |
| releases.buildsRequest | POST /api/builds/request | ../tooling/release/sim.py:158:14<br>packages/core/helix-backend/src/releases/api-router.ts:182:49 |
| releases.ciArtifactUploadUrl | POST /api/ci/artifacts/upload-url | ../tooling/release/sim.py:201:18<br>packages/core/helix-backend/src/releases/api-router.ts:149:49 |
| releases.ciRegisterRelease | POST /api/ci/releases | ../tooling/release/sim.py:226:14<br>packages/core/helix-backend/src/releases/api-router.ts:165:49 |
| releases.otaTrigger | POST /api/ota/trigger | ../tooling/release/sim.py:374:28<br>packages/core/helix-backend/src/releases/api-router.ts:320:49 |

## Unused Procedures

- countPublished (query) at packages/core/helix-backend/src/blog/router.ts:115:5
- devices.events (query) at packages/core/helix-backend/src/devices/admin-router.ts:216:5
- espFlasher.getFirmwares (query) at packages/core/device-apps/src/esp32-flasher/router.ts:22:5
- features.catalog (query) at packages/core/helix-backend/src/features/admin-router.ts:33:5
- features.deviceOverrides (query) at packages/core/helix-backend/src/features/admin-router.ts:76:5
- ice.config (query) at packages/core/helix-backend/src/ice/index.ts:76:5
