/**
 * Permissions Snapshot Module
 *
 * This module provides functionality to record and compare IAM permissions
 * used during CLI integration tests. It captures:
 * - All IAM roles assumed during test execution
 * - All IAM actions performed during test execution
 *
 * The captured data is saved as a snapshot file that can be used to detect
 * unexpected changes in IAM permission requirements.
 */

export * from './permissions-snapshot';
export * from './sdk-interceptor';
export * from './types';
