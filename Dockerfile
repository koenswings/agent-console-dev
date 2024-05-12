# -----------------------------------------------------------------------------
# base
# ------------------------------------------------------------------------------

FROM ubuntu as base
RUN apt-get update --fix-missing

# Install various utilities
RUN apt-get install -y vim curl wget git       
RUN apt-get install -y net-tools iputils-ping  iptables # route command and ping during dev

# Install npm, pnpm and node
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
RUN npm install -g -y n pnpm 

# Initialise pnpm 
# All packages will be added to /pnpm, outside the /app folder
ENV SHELL bash
ENV PNPM_HOME /pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN pnpm setup 

# Expose ports
# EXPOSE 5173

# Replace sh by bash so that the terminal window in Docker Desktop starts with bash
RUN ln -sf /bin/bash /bin/sh

# ------------------------------------------------------------------------------
# base_with_source
# ------------------------------------------------------------------------------

FROM base as base_with_source

# Add the source code
COPY . /console
WORKDIR /console
