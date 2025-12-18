# GitHub Actions Workflows

This directory contains GitHub Actions workflows for CI/CD of the gym-rag-service.

## Available Workflows

### 1. `ci.yml` - Continuous Integration

- **Triggers**: Push/PR to main, master, develop branches
- **Purpose**: Run tests, linting, and build verification
- **Jobs**:
  - Lint and Type Check
  - Build Application
  - Docker Build Test

### 2. `deploy.yml` - Full Deployment Pipeline

- **Triggers**: Push to main/master, manual dispatch
- **Purpose**: Build Docker image, push to registry, and deploy to server
- **Jobs**:
  - Build and Push Docker Image (to Docker Hub)
  - Deploy to Server (via SSH)
- **Requirements**:
  - `DOCKER_USERNAME` - Docker Hub username
  - `DOCKER_PASSWORD` - Docker Hub password/token
  - `SSH_PRIVATE_KEY` - SSH private key for server access
  - `SERVER_HOST` - Server hostname/IP
  - `SERVER_USER` - SSH username
  - `SERVER_PORT` (optional) - Application port (default: 8081)

### 3. `deploy-simple.yml` - Simple Deployment

- **Triggers**: Push to main/master, manual dispatch
- **Purpose**: Direct deployment without Docker Hub (builds on server)
- **Jobs**:
  - Deploy Application (builds Docker image on server)
- **Requirements**:
  - `SSH_PRIVATE_KEY` - SSH private key for server access
  - `SERVER_HOST` - Server hostname/IP
  - `SERVER_USER` - SSH username
  - `SERVER_PORT` (optional) - Application port (default: 8081)

## Setup Instructions

### 1. Configure GitHub Secrets

Go to your repository → Settings → Secrets and variables → Actions, and add:

#### For `deploy.yml` (Docker Hub deployment):

```
DOCKER_USERNAME=your_dockerhub_username
DOCKER_PASSWORD=your_dockerhub_token
SSH_PRIVATE_KEY=your_ssh_private_key
SERVER_HOST=your.server.com
SERVER_USER=deploy
SERVER_PORT=8081
```

#### For `deploy-simple.yml` (Direct deployment):

```
SSH_PRIVATE_KEY=your_ssh_private_key
SERVER_HOST=your.server.com
SERVER_USER=deploy
SERVER_PORT=8081
```

### 2. Generate SSH Key Pair

On your local machine:

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions_deploy
```

Add the public key to your server:

```bash
ssh-copy-id -i ~/.ssh/github_actions_deploy.pub user@your.server.com
```

Add the private key (`~/.ssh/github_actions_deploy`) to GitHub Secrets as `SSH_PRIVATE_KEY`.

### 3. Prepare Server

On your deployment server:

```bash
# Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose (if not included)
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Create deployment directory
sudo mkdir -p /opt/gym-rag-service
sudo chown $USER:$USER /opt/gym-rag-service

# Create .env file (copy from .env.example and fill in values)
cd /opt/gym-rag-service
nano .env
```

### 4. Server Prerequisites

Ensure your server has:

- Docker installed and running
- Docker Compose installed
- Port 8081 (or your configured port) open in firewall
- PostgreSQL and Redis accessible (either via docker-compose or external services)

### 5. Update docker-compose.yml

Make sure your `docker-compose.yml` includes PostgreSQL and Redis services if deploying everything together, or configure your app to connect to external database.

## Usage

### Automatic Deployment

- Push to `main` or `master` branch → Automatic deployment
- Create a PR → CI runs but no deployment

### Manual Deployment

1. Go to Actions tab in GitHub
2. Select the workflow (e.g., "Simple Deploy")
3. Click "Run workflow"
4. Select branch and click "Run workflow"

## Troubleshooting

### SSH Connection Issues

- Verify SSH key is correctly added to GitHub Secrets
- Check server SSH configuration allows key-based authentication
- Test SSH connection manually: `ssh -i ~/.ssh/github_actions_deploy user@server`

### Docker Build Failures

- Check Dockerfile syntax
- Verify all dependencies are in package.json
- Check build logs in GitHub Actions

### Deployment Failures

- Check server logs: `docker-compose logs` on server
- Verify environment variables are set correctly
- Check server has enough disk space and memory
- Verify ports are not already in use

### Health Check Failures

- Verify application is running: `docker-compose ps`
- Check application logs: `docker-compose logs app`
- Verify health endpoint is accessible: `curl http://localhost:8081/health`

## Notes

- The `deploy.yml` workflow uses Docker Hub. Consider using GitHub Container Registry (ghcr.io) for private repositories.
- For production, consider adding:
  - Database migration steps
  - Backup before deployment
  - Rollback mechanism
  - Monitoring and alerting
  - Blue-green deployment strategy
