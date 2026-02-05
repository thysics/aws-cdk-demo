/**
 * Jest setup file for permissions snapshot testing
 * 
 * Add this to your Jest configuration to automatically record and assert
 * permissions snapshots for integration tests.
 * 
 * @example
 * // jest.config.js
 * module.exports = {
 *   setupFilesAfterEnv: ['@aws-cdk/permissions-snapshot/jest-setup'],
 * };
 */

import * as path from 'path';
import {
  PermissionsRecorder,
  permissionsRecorderPlugin,
} from './index';

declare global {
  namespace NodeJS {
    interface Global {
      __PERMISSIONS_RECORDER__?: PermissionsRecorder;
    }
  }
}

// Check if permissions recording is enabled
const isRecordingEnabled = process.env.RECORD_PERMISSIONS === 'true' ||
                           process.env.RECORD_PERMISSIONS === '1';

// Check if snapshot updates are enabled
const updateSnapshots = process.env.UPDATE_PERMISSIONS_SNAPSHOTS === 'true' ||
                        process.env.UPDATE_PERMISSIONS_SNAPSHOTS === '1' ||
                        process.env.UPDATE_SNAPSHOTS === 'true' ||
                        process.env.UPDATE_SNAPSHOTS === '1';

// Default snapshot directory
const snapshotDir = process.env.PERMISSIONS_SNAPSHOT_DIR || './permissions-snapshots';

/**
 * Get or create a permissions recorder for the current test
 */
export function getPermissionsRecorder(): PermissionsRecorder | undefined {
  return (global as any).__PERMISSIONS_RECORDER__;
}

/**
 * Get the permissions recorder plugin to add to AWS SDK clients
 */
export function getPermissionsRecorderPlugin() {
  return permissionsRecorderPlugin;
}

/**
 * Check if permissions recording is enabled
 */
export function isPermissionsRecordingEnabled(): boolean {
  return isRecordingEnabled;
}

// Only set up hooks if recording is enabled
if (isRecordingEnabled) {
  beforeEach(() => {
    const testName = expect.getState().currentTestName || 'unknown-test';
    const testPath = expect.getState().testPath || '';
    
    // Create a sanitized filename from test name and path
    const sanitizedTestName = testName.replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 100);
    const testDir = path.dirname(testPath);
    const snapshotPath = path.join(testDir, snapshotDir, `${sanitizedTestName}.permissions.snap`);

    const recorder = new PermissionsRecorder({
      testName,
      snapshotPath,
      updateSnapshot: updateSnapshots,
    });

    (global as any).__PERMISSIONS_RECORDER__ = recorder;
    recorder.start();
  });

  afterEach(() => {
    const recorder = (global as any).__PERMISSIONS_RECORDER__ as PermissionsRecorder | undefined;
    
    if (recorder && recorder.isRecording()) {
      try {
        recorder.assertSnapshot();
      } catch (error) {
        // Re-throw to fail the test
        throw error;
      }
    }

    (global as any).__PERMISSIONS_RECORDER__ = undefined;
  });
}

/**
 * Manual helper for tests that need explicit control over recording
 */
export function createTestPermissionsRecorder(options?: {
  testName?: string;
  snapshotPath?: string;
  updateSnapshot?: boolean;
}): PermissionsRecorder {
  const testName = options?.testName || expect.getState().currentTestName || 'unknown-test';
  const testPath = expect.getState().testPath || '';
  
  const sanitizedTestName = testName.replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 100);
  const testDir = path.dirname(testPath);
  const snapshotPath = options?.snapshotPath || 
    path.join(testDir, snapshotDir, `${sanitizedTestName}.permissions.snap`);

  return new PermissionsRecorder({
    testName,
    snapshotPath,
    updateSnapshot: options?.updateSnapshot ?? updateSnapshots,
  });
}
