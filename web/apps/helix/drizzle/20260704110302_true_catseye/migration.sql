CREATE TABLE "artifact" (
	"id" text PRIMARY KEY,
	"type_key" text NOT NULL,
	"storage_mode" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"sha256" text,
	"size_bytes" bigint,
	"storage_key" text,
	"content_type" text,
	"registry" text,
	"coordinate" text,
	"ref_version" text,
	"digest" text,
	"ref_metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_type" (
	"key" text PRIMARY KEY,
	"display_name" text NOT NULL,
	"distribution_mode" text NOT NULL,
	"default_registry" text,
	"selector_keys" jsonb NOT NULL,
	"roles" jsonb NOT NULL,
	"adapter_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build" (
	"id" text PRIMARY KEY,
	"type_key" text NOT NULL,
	"source" text NOT NULL,
	"owner_user_id" text,
	"status" text NOT NULL,
	"request_config" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"selector" jsonb,
	"release_id" text,
	"variant_id" text,
	"callback_token_hash" text,
	"callback_expires_at" timestamp,
	"analysis" jsonb,
	"error_summary" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ci_token" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL CONSTRAINT "ci_token_hash_uq" UNIQUE,
	"scopes" jsonb NOT NULL,
	"owner_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "device_profile" (
	"device_id" text,
	"profile_id" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_profile_pkey" PRIMARY KEY("device_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text,
	"owner_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_track" (
	"id" text PRIMARY KEY,
	"profile_id" text NOT NULL,
	"type_key" text NOT NULL,
	"release_name" text NOT NULL,
	"channel" text,
	"pinned_release_id" text,
	"selector" jsonb,
	"auto_update" boolean DEFAULT true NOT NULL,
	CONSTRAINT "profile_track_uq" UNIQUE("profile_id","type_key","release_name")
);
--> statement-breakpoint
CREATE TABLE "release" (
	"id" text PRIMARY KEY,
	"type_key" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"owner_user_id" text,
	"build_id" text,
	"source_commit" text,
	"source_dirty" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"analysis" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	CONSTRAINT "release_type_name_version_uq" UNIQUE("type_key","name","version")
);
--> statement-breakpoint
CREATE TABLE "release_channel_head" (
	"id" text PRIMARY KEY,
	"type_key" text NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"release_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "release_channel_head_uq" UNIQUE("type_key","name","channel")
);
--> statement-breakpoint
CREATE TABLE "variant" (
	"id" text PRIMARY KEY,
	"release_id" text NOT NULL,
	"selector" jsonb NOT NULL,
	"selector_hash" text NOT NULL,
	"name" text,
	"manifest" jsonb,
	"analysis" jsonb,
	"build_id" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "variant_release_selector_uq" UNIQUE("release_id","selector_hash")
);
--> statement-breakpoint
CREATE TABLE "variant_artifact" (
	"id" text PRIMARY KEY,
	"variant_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"role" text NOT NULL,
	"offset" text,
	"path" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "variant_artifact_variant_role_uq" UNIQUE("variant_id","role")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_sha256_uq" ON "artifact" ("sha256") WHERE storage_mode = 'blob';--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_ref_uq" ON "artifact" ("registry","coordinate","digest") WHERE storage_mode = 'ref';--> statement-breakpoint
CREATE INDEX "artifact_type_idx" ON "artifact" ("type_key");--> statement-breakpoint
CREATE INDEX "build_config_hash_idx" ON "build" ("config_hash","status");--> statement-breakpoint
CREATE INDEX "ci_token_prefix_idx" ON "ci_token" ("token_prefix");--> statement-breakpoint
CREATE INDEX "release_lookup_idx" ON "release" ("type_key","name","channel","status");--> statement-breakpoint
CREATE INDEX "variant_selector_gin_idx" ON "variant" USING gin ("selector" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "variant_release_idx" ON "variant" ("release_id");--> statement-breakpoint
CREATE INDEX "variant_artifact_artifact_idx" ON "variant_artifact" ("artifact_id");--> statement-breakpoint
ALTER TABLE "profile_track" ADD CONSTRAINT "profile_track_profile_id_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "variant" ADD CONSTRAINT "variant_release_id_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "release"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "variant_artifact" ADD CONSTRAINT "variant_artifact_variant_id_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "variant"("id") ON DELETE CASCADE;