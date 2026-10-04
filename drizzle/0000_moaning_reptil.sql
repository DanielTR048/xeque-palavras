CREATE TABLE `profile_documents` (
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`document` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `profile_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`nonce_hash` text NOT NULL,
	`key_hash` text NOT NULL,
	`envelope` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_token_unique` ON `sync_devices` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `owner_pairing_nonce_unique` ON `sync_devices` (`owner_id`,`nonce_hash`);