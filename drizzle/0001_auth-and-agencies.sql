CREATE TYPE "public"."agency_type" AS ENUM('roads', 'drainage', 'water', 'power', 'waste', 'streetlights');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_level" AS ENUM('state', 'lga');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('resident', 'agency_officer', 'agency_admin', 'platform_admin');--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "agency_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agency_jurisdictions" (
	"agency_id" uuid NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agency_jurisdictions_agency_id_jurisdiction_id_pk" PRIMARY KEY("agency_id","jurisdiction_id")
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"level" "jurisdiction_level" NOT NULL,
	"parent_id" uuid,
	"geom" geometry(MultiPolygon, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"role" "user_role" DEFAULT 'resident' NOT NULL,
	"agency_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_agency_scope" CHECK (("users"."role" in ('agency_officer', 'agency_admin')) = ("users"."agency_id" is not null)),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "agency_jurisdictions" ADD CONSTRAINT "agency_jurisdictions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_jurisdictions" ADD CONSTRAINT "agency_jurisdictions_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_parent_id_jurisdictions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_jurisdictions_jurisdiction_idx" ON "agency_jurisdictions" USING btree ("jurisdiction_id");--> statement-breakpoint
CREATE INDEX "jurisdictions_geom_gist" ON "jurisdictions" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "jurisdictions_parent_idx" ON "jurisdictions" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_agency_idx" ON "users" USING btree ("agency_id");