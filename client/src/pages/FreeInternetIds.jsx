import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  createInternetFreeIds,
  createInternetFreeIdsBulk,
  getInternetBranches,
  getInternetFreeIds
} from '../services/internetRegistrationService';
import '../styles/FreeInternetIds.css';

const loadXlsx = async () => import('xlsx');

const normalizeBranchHeader = (value) => String(value || '').trim().toLowerCase();

const FreeInternetIds = () => {
  const navigate = useNavigate();
  const [viewBranchCode, setViewBranchCode] = useState('');
  const [selectedBranchCode, setSelectedBranchCode] = useState('');
  const [freeIdNumber, setFreeIdNumber] = useState('');
  const [saveMessage, setSaveMessage] = useState(null);
  const [bulkMessage, setBulkMessage] = useState(null);
  const { data: branches = [] } = useQuery({
    queryKey: ['internet-branches'],
    queryFn: getInternetBranches
  });

  const { data = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['internet-free-ids'],
    queryFn: getInternetFreeIds
  });

  const filteredBranches = viewBranchCode
    ? data.filter((branch) => String(branch.branch_code || '') === viewBranchCode)
    : [];
  const createMutation = useMutation({
    mutationFn: createInternetFreeIds,
    onSuccess: (payload) => {
      setSaveMessage({
        type: 'success',
        text: `Inserted: ${payload?.inserted_count || 0}, Skipped: ${payload?.skipped_count || 0}`
      });
      setSelectedBranchCode('');
      setFreeIdNumber('');
      refetch();
    },
    onError: (err) => {
      setSaveMessage({
        type: 'danger',
        text: err?.response?.data?.message || 'Free ID create failed.'
      });
    }
  });
  const bulkCreateMutation = useMutation({
    mutationFn: createInternetFreeIdsBulk,
    onSuccess: (payload) => {
      setBulkMessage({
        type: 'success',
        text: `Bulk done. Inserted: ${payload?.inserted_count || 0}, Skipped: ${payload?.skipped_count || 0}, Errors: ${payload?.error_count || 0}`
      });
      refetch();
    },
    onError: (err) => {
      setBulkMessage({
        type: 'danger',
        text: err?.response?.data?.message || 'Bulk upload failed.'
      });
    }
  });

  const handleSelect = (branch, item) => {
    const params = new URLSearchParams({
      freeIdPoolId: String(item.id),
      userIdIp: item.user_id_ip,
      branchCode: branch.branch_code || '',
      branchName: branch.branch_name || ''
    });
    navigate(`/internet-registration?${params.toString()}`);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSaveMessage(null);
    const selectedBranch = branches.find((branch) => branch.code === selectedBranchCode);
    if (!selectedBranch) return;

    createMutation.mutate({
      branch_code: selectedBranch.code,
      branch_name: selectedBranch.name,
      user_id_ip: freeIdNumber
    });
  };

  const handleDownloadTemplate = () => {
    const prepareTemplate = async () => {
      const XLSX = await loadXlsx();
      const headerBranches = branches.length
        ? branches.map((branch) => branch.name)
        : ['Boyra Office', 'Corporate Office', 'Gollamari Office', 'Shonadanga Office'];

      const worksheet = XLSX.utils.aoa_to_sheet([
        headerBranches,
        ...Array.from({ length: 30 }, () => headerBranches.map(() => ''))
      ]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'free_ids_template');
      XLSX.writeFile(workbook, 'free_ids_template.xlsx');
    };

    prepareTemplate().catch(() => {
      setBulkMessage({ type: 'danger', text: 'Template generate failed. Please try again.' });
    });
  };

  const handleBulkFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBulkMessage(null);

    try {
      // S14: client-side guardrails (server re-validates; this is just UX).
      if (file.size > 5 * 1024 * 1024) {
        setBulkMessage({ type: 'danger', text: 'File is too large (max 5 MB).' });
        return;
      }
      const XLSX = await loadXlsx();
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (matrix.length > 5000) {
        setBulkMessage({ type: 'danger', text: 'Too many rows (max 5000).' });
        return;
      }
      const headers = Array.isArray(matrix[0]) ? matrix[0] : [];
      const branchMap = new Map(
        branches.map((branch) => [normalizeBranchHeader(branch.name), { code: branch.code, name: branch.name }])
      );

      const normalizedRows = [];
      headers.forEach((headerCell, colIndex) => {
        const headerText = String(headerCell || '').trim();
        if (!headerText) return;
        const branch = branchMap.get(normalizeBranchHeader(headerText));
        if (!branch) return;

        for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
          const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
          const rawId = String(row[colIndex] || '').trim();
          if (!rawId) continue;
          normalizedRows.push({
            branch_code: branch.code,
            branch_name: branch.name,
            user_id_ip: rawId
          });
        }
      });

      if (!normalizedRows.length) {
        setBulkMessage({
          type: 'danger',
          text: 'No valid IDs found. First row must contain branch names, IDs must be under each branch column.'
        });
        return;
      }
      bulkCreateMutation.mutate(normalizedRows);
    } catch (err) {
      setBulkMessage({ type: 'danger', text: 'Could not read file. Upload a valid XLSX/CSV file.' });
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="free-ids-page">
      <div className="free-ids-header">
        <div>
          <h2>Internet Free ID List</h2>
          <p>Select a branch from the dropdown to view only that branch&apos;s available IDs.</p>
        </div>
        <div className="free-ids-header-actions">
          <select
            className="form-control branch-filter-select"
            value={viewBranchCode}
            onChange={(e) => setViewBranchCode(e.target.value)}
          >
            <option value="">Select Branch To View</option>
            {data.map((branch) => (
              <option key={branch.branch_code} value={branch.branch_code}>
                {branch.branch_name || branch.branch_code}
              </option>
            ))}
          </select>
          <button className="btn btn-outline-primary" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <section className="create-free-id-card">
        <h4>Create / Input Free IDs</h4>
        {saveMessage && <div className={`alert alert-${saveMessage.type} mb-2`}>{saveMessage.text}</div>}
        <form className="create-free-id-form" onSubmit={handleSubmit}>
          <select
            className="form-control"
            value={selectedBranchCode}
            onChange={(e) => setSelectedBranchCode(e.target.value)}
            required
          >
            <option value="">Select Branch</option>
            {branches.map((branch) => (
              <option key={branch.code} value={branch.code}>{branch.name}</option>
            ))}
          </select>
          <input
            className="form-control"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{4,5}"
            placeholder="Enter 4-5 digit ID (e.g., 1001)"
            value={freeIdNumber}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '').slice(0, 5);
              setFreeIdNumber(value);
            }}
            disabled={!selectedBranchCode}
            required
          />
          <button type="submit" className="btn btn-success" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Saving...' : 'Save Free IDs'}
          </button>
        </form>
        <div className="bulk-upload-box">
          <div className="bulk-upload-actions">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleDownloadTemplate}>
              Download Template
            </button>
            <label className="btn btn-outline-primary btn-sm mb-0">
              Upload Sheet
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleBulkFileChange}
                disabled={bulkCreateMutation.isPending}
                hidden
              />
            </label>
          </div>
          <small className="text-muted">
            Template format: first row = branch names, enter 4-5 digit IDs under each branch column in the rows below.
          </small>
          {bulkMessage && <div className={`alert alert-${bulkMessage.type} mt-2 mb-0`}>{bulkMessage.text}</div>}
        </div>
      </section>

      {isLoading && <div className="alert alert-info">Free IDs loading...</div>}
      {isError && <div className="alert alert-danger">{error?.response?.data?.message || 'Failed to load free IDs.'}</div>}
      {!isLoading && !isError && data.length === 0 && (
        <div className="alert alert-warning">No free ID found right now.</div>
      )}
      {!isLoading && !isError && data.length > 0 && !viewBranchCode && (
        <div className="alert alert-info">Select a branch to view available IDs.</div>
      )}
      {!isLoading && !isError && viewBranchCode && filteredBranches.length === 0 && (
        <div className="alert alert-warning">No available IDs in this branch.</div>
      )}

      <div className="branch-grid">
        {filteredBranches.map((branch) => (
          <section key={branch.branch_code} className="branch-card">
            <header>
              <h3>{branch.branch_name || branch.branch_code}</h3>
              <span>{branch.available_count} free</span>
            </header>

            <div className="table-wrap">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>User ID/IP</th>
                    <th>Remarks</th>
                    <th className="text-end">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {branch.ids.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.user_id_ip}</strong></td>
                      <td>{item.remarks || '-'}</td>
                      <td className="text-end">
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => handleSelect(branch, item)}>
                          Use This ID
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default FreeInternetIds;
