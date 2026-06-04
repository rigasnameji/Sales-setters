# Use a lightweight Node.js base image
FROM node:20-bullseye-slim

# Install Python 3 and basic build tools
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

# Create and set the working directory
WORKDIR /app

# Copy the entire project into the container
COPY . .

# Navigate to the dashboard directory and install Node.js dependencies
RUN cd dashboard && npm install

# Expose the port the dashboard runs on
EXPOSE 3030

# Start the Node.js server from the dashboard directory
CMD ["node", "dashboard/server.js"]
