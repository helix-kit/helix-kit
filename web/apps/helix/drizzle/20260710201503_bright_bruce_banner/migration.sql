CREATE TABLE "device_feature_override" (
	"device_id" text,
	"feature_key" text,
	"enabled" boolean NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_feature_override_pkey" PRIMARY KEY("device_id","feature_key")
);
--> statement-breakpoint
CREATE TABLE "feature" (
	"key" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_feature" (
	"profile_id" text,
	"feature_key" text,
	CONSTRAINT "profile_feature_pkey" PRIMARY KEY("profile_id","feature_key")
);
--> statement-breakpoint
ALTER TABLE "profile_feature" ADD CONSTRAINT "profile_feature_profile_id_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE;