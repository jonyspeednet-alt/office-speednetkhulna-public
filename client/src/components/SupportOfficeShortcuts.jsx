import React from 'react';
import { BRANCHES } from '../constants/branches';
import '../styles/SupportOfficeShortcuts.css';

const labels = {
  'Corporate Office': 'Head Office',
};

const SupportOfficeShortcuts = ({ selectedOffice, onSelect }) => (
  <nav className="support-office-shortcuts" aria-label="Quick filter by office">
    <span className="support-office-shortcuts-title">Quick office view</span>
    <div className="support-office-shortcuts-list">
      <button
        type="button"
        className={!selectedOffice ? 'active' : ''}
        aria-pressed={!selectedOffice}
        onClick={() => onSelect('')}
      >
        All Offices
      </button>
      {BRANCHES.map((branch) => (
        <button
          key={branch.code}
          type="button"
          className={selectedOffice === branch.name ? 'active' : ''}
          aria-pressed={selectedOffice === branch.name}
          onClick={() => onSelect(branch.name)}
        >
          {labels[branch.name] || branch.name.replace(/ Office$/, '')}
        </button>
      ))}
    </div>
  </nav>
);

export default SupportOfficeShortcuts;
