#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { SnapshotManager, SNAPSHOT_EXTENSION } from '../lib/snapshot-manager';
import type { PermissionsSnapshot } from '../lib/types';

interface CommandOptions {
  command: 'view' | 'compare' | 'merge' | 'list' | 'help';
  files: string[];
  output?: string;
}

function parseArgs(args: string[]): CommandOptions {
  const command = args[0] as CommandOptions['command'] || 'help';
  const files: string[] = [];
  let output: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--output') {
      output = args[++i];
    } else if (!args[i].startsWith('-')) {
      files.push(args[i]);
    }
  }

  return { command, files, output };
}

function printUsage(): void {
  console.log(`
Usage: permissions-snapshot <command> [options] [files...]

Commands:
  view <file>                  View a permissions snapshot file
  compare <file1> <file2>      Compare two snapshot files
  merge <files...>             Merge multiple snapshot files into one
  list <directory>             List all snapshot files in a directory
  help                         Show this help message

Options:
  -o, --output <file>          Output file for merge command

Examples:
  permissions-snapshot view ./test.permissions.snap
  permissions-snapshot compare ./old.snap ./new.snap
  permissions-snapshot merge ./snaps/*.snap -o ./combined.snap
  permissions-snapshot list ./test/snapshots
`);
}

function viewSnapshot(filePath: string): void {
  const snapshot = SnapshotManager.loadSnapshot(filePath);
  if (!snapshot) {
    console.error(`Failed to load snapshot: ${filePath}`);
    process.exit(1);
  }
  console.log(SnapshotManager.formatSnapshot(snapshot));
}

function compareSnapshots(file1: string, file2: string): void {
  const snapshot1 = SnapshotManager.loadSnapshot(file1);
  const snapshot2 = SnapshotManager.loadSnapshot(file2);

  if (!snapshot1) {
    console.error(`Failed to load snapshot: ${file1}`);
    process.exit(1);
  }
  if (!snapshot2) {
    console.error(`Failed to load snapshot: ${file2}`);
    process.exit(1);
  }

  const result = SnapshotManager.compareSnapshots(snapshot1, snapshot2);

  console.log(`Comparing snapshots:`);
  console.log(`  Baseline: ${file1}`);
  console.log(`  Current:  ${file2}`);
  console.log();

  if (result.match) {
    console.log('✓ Snapshots match');
  } else {
    console.log('✗ Snapshots differ');
    console.log();
    console.log(result.diffMessage);
    process.exit(1);
  }
}

function mergeSnapshots(files: string[], output: string): void {
  const allActions = new Map<string, any>();
  const allRoleAssumptions = new Map<string, any>();
  const testNames: string[] = [];

  for (const file of files) {
    const snapshot = SnapshotManager.loadSnapshot(file);
    if (!snapshot) {
      console.error(`Failed to load snapshot: ${file}`);
      continue;
    }

    testNames.push(snapshot.testName);

    for (const action of snapshot.actions) {
      const key = action.iamAction;
      if (!allActions.has(key)) {
        allActions.set(key, action);
      }
    }

    for (const role of snapshot.roleAssumptions) {
      const key = role.roleArn;
      if (!allRoleAssumptions.has(key)) {
        allRoleAssumptions.set(key, role);
      }
    }
  }

  const mergedSnapshot = SnapshotManager.createSnapshot(
    `merged: ${testNames.join(', ')}`,
    Array.from(allActions.values()),
    Array.from(allRoleAssumptions.values()),
  );

  SnapshotManager.saveSnapshot(mergedSnapshot, output);
  console.log(`Merged ${files.length} snapshots into: ${output}`);
  console.log(`  Total unique actions: ${mergedSnapshot.summary.totalActions}`);
  console.log(`  Total role assumptions: ${mergedSnapshot.summary.totalRoleAssumptions}`);
}

function listSnapshots(directory: string): void {
  if (!fs.existsSync(directory)) {
    console.error(`Directory not found: ${directory}`);
    process.exit(1);
  }

  const files = fs.readdirSync(directory)
    .filter(f => f.endsWith(SNAPSHOT_EXTENSION))
    .map(f => path.join(directory, f));

  if (files.length === 0) {
    console.log(`No snapshot files found in: ${directory}`);
    return;
  }

  console.log(`Found ${files.length} snapshot files in ${directory}:\n`);

  for (const file of files) {
    const snapshot = SnapshotManager.loadSnapshot(file);
    if (snapshot) {
      console.log(`${path.basename(file)}`);
      console.log(`  Test: ${snapshot.testName}`);
      console.log(`  Actions: ${snapshot.summary.totalActions}`);
      console.log(`  Role Assumptions: ${snapshot.summary.totalRoleAssumptions}`);
      console.log(`  Services: ${snapshot.summary.services.join(', ')}`);
      console.log();
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  switch (options.command) {
    case 'view':
      if (options.files.length !== 1) {
        console.error('view command requires exactly one file');
        process.exit(1);
      }
      viewSnapshot(options.files[0]);
      break;

    case 'compare':
      if (options.files.length !== 2) {
        console.error('compare command requires exactly two files');
        process.exit(1);
      }
      compareSnapshots(options.files[0], options.files[1]);
      break;

    case 'merge':
      if (options.files.length < 2) {
        console.error('merge command requires at least two files');
        process.exit(1);
      }
      if (!options.output) {
        console.error('merge command requires -o/--output option');
        process.exit(1);
      }
      mergeSnapshots(options.files, options.output);
      break;

    case 'list':
      if (options.files.length !== 1) {
        console.error('list command requires exactly one directory');
        process.exit(1);
      }
      listSnapshots(options.files[0]);
      break;

    case 'help':
    default:
      printUsage();
      break;
  }
}

main();
