# Use an official Python runtime as the base image

FROM nikolaik/python-nodejs:python3.9-nodejs16
#FROM python:3.9

# Set environment variables
ENV PYTHONUNBUFFERED 1

# Set the working directory in the container
WORKDIR /app/

# Copy the requirements file into the container
COPY requirements.txt /app/

# Install Python packages specified in the requirements file
RUN pip install --no-cache-dir -r requirements.txt

# Initialize a new package.json and install xterm
#RUN npm init -y 
#CMD ["NPM","install","-g","xterm"]
RUN npm install -g xterm 
RUN npm install -g xterm-addon-fit 

#Copy xterm.js and xterm.css to Django's static directory
RUN mkdir -p /app/CommandAndControl/assets/xterm && \
    cp /usr/lib/node_modules/xterm/css/xterm.css /app/CommandAndControl/assets/xterm/ && \
    cp /usr/lib/node_modules/xterm/lib/xterm.js /app/CommandAndControl/assets/xterm/ && \
    cp /usr/lib/node_modules/xterm-addon-fit/lib/xterm-addon-fit.js /app/CommandAndControl/assets/xterm
# set the working directory for django
WORKDIR /app/CommandAndControl

# Copy the current directory (i.e., your Django app) into the container
COPY . /app/
