#!/bin/bash
# Paste into "User data" when launching the EC2 instance (Ubuntu 24.04).
# Installs Docker and prepares the folder the deploy workflow writes to.
set -euxo pipefail
apt-get update
apt-get install -y docker.io docker-compose-v2
systemctl enable --now docker
usermod -aG docker ubuntu
mkdir -p /opt/similarwise
chown ubuntu:ubuntu /opt/similarwise
