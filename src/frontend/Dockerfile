# Stage 1: Build Angular application
FROM node:18-alpine AS build

WORKDIR /app

# Copy package files first for better caching
COPY src/frontend/package*.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy all source files and configs (excluding files in .dockerignore)
COPY src/frontend/ ./

# Build Angular app for production
RUN npx nx build --configuration=production --verbose

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Copy built app from build stage
COPY --from=build /app/dist/frontend /usr/share/nginx/html

# Copy nginx configuration
COPY src/frontend/nginx.conf /etc/nginx/nginx.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
