# # Use an official Python runtime as the base image
FROM python:3.9

# Set environment variables
ENV PYTHONUNBUFFERED 1

# Set the working directory in the container
WORKDIR /app/CommandAndControl

# Copy the requirements file into the container
COPY requirements.txt /app/

# Install Python packages specified in the requirements file
RUN pip install --no-cache-dir -r requirements.txt

# Copy the current directory (i.e., your Django app) into the container
COPY . /app/
