# Contributing

Start with the task-app example. Describe a concrete problem and reproduction
before proposing an abstraction. Small fixes, clearer guide steps and independently
verified journey examples are useful contributions.

Use Node 24. Run build, core tests and example proof. Prefer real entry-point
failure coverage before implementation; avoid constant mirrors and source/prose
policy tests. Keep the Node runner independent of React. Drivers own application
actions and resources; the runner owns sequencing, browser and safe receipts.

Explain observable before/after behavior and proof in pull requests. Do not record
secrets, browser storage or raw exceptions. Keep the preview small.
