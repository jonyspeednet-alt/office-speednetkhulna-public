/**
 * Work Location & Employment Type Constants
 * Shared between AppointmentGenerator, TerminationGenerator and employee forms
 */

// Work locations (branches) for employees & letters
export const WORK_LOCATIONS = [
  { value: 'Khulna Head Office', label: 'Khulna Head Office' },
  { value: 'Sonadanga Office', label: 'Sonadanga Office' },
  { value: 'Gollamari Office', label: 'Gollamari Office' },
  { value: 'Boyra Office', label: 'Boyra Office' },
];

// Employment types (values are stored in DB — keep values unchanged, labels are display-only)
export const EMPLOYMENT_TYPES = [
  { value: 'পূর্ণকালীন (Full-Time, Permanent)', label: 'Full-Time, Permanent' },
  { value: 'আংশিককালীন (Part-Time)', label: 'Part-Time' },
  { value: 'চুক্তিভিত্তিক (Contract)', label: 'Contract' },
  { value: 'ইন্টার্ন (Intern)', label: 'Intern' },
];

// Legacy alias (used by AppointmentGenerator)
export const BRANCH_OFFICES = WORK_LOCATIONS;
