CREATE TABLE `access_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`bootstrap` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lead_work` (
	`lead_id` text PRIMARY KEY NOT NULL,
	`assigned_to` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`next_contact` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_claims` (
	`hash` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`staff_version` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_staff` ON `sessions` (`staff_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires`);--> statement-breakpoint
CREATE TABLE `staff` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'pending' NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_updates` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
