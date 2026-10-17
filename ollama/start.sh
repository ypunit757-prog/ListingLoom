#!/bin/sh
ollama serve &
until ollama list >/dev/null 2>&1; do sleep 1; done
ollama pull "${MODEL:-gemma3:1b}"
wait
