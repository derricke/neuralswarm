---
name: run-graphify
description: >
  Use graphify to update the codebase graph, explore architecture, and query code relationships.
---

# Run Graphify

Graphify is a tool installed globally on the system that analyzes the codebase and generates an interconnected graph of the project's architecture, dependencies, and structure.

## Updating the Graph
If the codebase has changed significantly and you need a fresh understanding of its structure, update the graph by running:
```bash
graphify update .
```
This command updates the files in the `graphify-out/` directory.

## Analyzing the Codebase
To understand the high-level architecture and community structure:
1. Read `graphify-out/GRAPH_REPORT.md`. This report contains a summary of the graph, highly connected "God Nodes", and "Communities" (modules) in the codebase.
2. Use this information to navigate the codebase efficiently and understand dependencies before making structural changes.

## Querying the Graph
To find specific files, functions, or architectural patterns related to a feature, you can query the graph directly:
```bash
graphify query "<your search topic or question>"
```
This will output a list of relevant files and nodes that form the context for your query. Use this command to quickly locate where specific functionality is implemented.
