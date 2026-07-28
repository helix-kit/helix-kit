CREATE TABLE "post" (
	"id" text PRIMARY KEY,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL CONSTRAINT "post_slug_unique" UNIQUE,
	"content" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_image" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"reading_time" integer,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "post_author_idx" ON "post" ("author_id");--> statement-breakpoint
CREATE INDEX "post_published_idx" ON "post" ("published");--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE CASCADE;