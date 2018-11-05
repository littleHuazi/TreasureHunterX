#!/bin/bash

basedir=$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )

PID_FILE="$basedir/treasure-hunter.pid"
pid=$( cat "$PID_FILE" )

echo "killing process of id $pid"
kill $pid 
