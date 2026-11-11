# Clean compiled resources and dependencies
clean:
	rm -rf ./.nuxt
	rm -rf ./.output
	rm -rf ./node_modules

# Install dependencies
install:
	bun install --frozen-lockfile

# Compile and build both apps into one server (use build-admin / build-chat for the production targets)
build:
	bun run build

# Build the admin app (dashboard, admin API, MCP, sync scheduler)
build-admin:
	bun run build:admin

# Build the chat app (chat page, chat API, embed.js)
build-chat:
	bun run build:chat

# Run type checking and tests
check:
	bun run check

# Run type checking only
typecheck:
	bun run typecheck

# Run tests only
test:
	bun run test

# Start only the local MongoDB container
db:
	docker compose up -d mongodb

# Run the dev server (admin and chat) on http://localhost:3000
dev:
	bun run dev

# Run the production build locally (the last one built: build, build-admin or build-chat)
start:
	bun run start

# Build the admin and chat Docker images
docker-build:
	docker build --target admin -t ragpulse-admin .
	docker build --target chat -t ragpulse-chat .

# Start MongoDB, admin and chat with Docker Compose
up:
	docker compose up -d --build

# Stop the Docker Compose services (MongoDB data stays in its volume)
down:
	docker compose down

# Update dependencies (within their semver ranges) and set new version
update:
	bun update
	npm pkg set version=$(shell date '+%y.%-V%u.1%H%M')
	bun run check

.PHONY: clean install build build-admin build-chat check typecheck test db dev start docker-build up down update
