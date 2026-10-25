import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import ModalWrap from "../ModalWrap";
import { notify } from "../../../utils/notify";

const ImportModal = ({
  importMonth,
  setImportMonth,
  importFile,
  setImportFile,
  importing,
  onImport,
  onClose,
  maximRows,
  maximLoading,
  onFetchMaxim,
}) => {
  const [parsedRows, setParsedRows] = useState([]);
  const [showOnlyDuplicates, setShowOnlyDuplicates] = useState(false);
  const [parseError, setParseError] = useState("");
  const [maximLoaded, setMaximLoaded] = useState(false);

  const getRowName = (row) => {
    const keys = ["Customer Name", "Customer", "User Name", "customer_name", "user_name"];
    for (const key of keys) {
      if (row[key] !== undefined) return String(row[key]).trim();
    }
    return "";
  };

  const getRowValue = (row, keys) => {
    for (const key of keys) {
      if (row[key] !== undefined) return row[key];
    }
    return "";
  };

  useEffect(() => {
    if (!importFile) {
      setParsedRows([]);
      setParseError("");
      return;
    }

    // S14: client-side guardrails — 5 MB / 5000 rows, proto-key strip.
    // (Server re-validates everything in xlsxGuard.js; this is just UX.)
    if (importFile.size > 5 * 1024 * 1024) {
      setParsedRows([]);
      setParseError("File too large (max 5 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        if (data.length === 0) {
          setParseError("No data found in the file.");
          return;
        }
        if (data.length > 5000) {
          setParsedRows([]);
          setParseError("Too many rows (max 5000). Please shrink the file and retry.");
          return;
        }
        // Rebuild rows with a null prototype so hostile keys
        // (__proto__/constructor/prototype) can never pollute anything.
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          if (!row || typeof row !== "object") continue;
          const clean = {};
          for (const k of Object.keys(row)) {
            if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
            clean[k] = row[k];
          }
          data[i] = clean;
        }

        // Count occurrences of each Customer Name to detect duplicates
        const nameCounts = {};
        data.forEach((row) => {
          const name = getRowName(row);
          if (name) {
            nameCounts[name] = (nameCounts[name] || 0) + 1;
          }
        });

        const rows = data.map((row, idx) => {
          const name = getRowName(row);
          const rxAmt = getRowValue(row, ["Receive Amount", "Received Amount", "Receive", "Paid Amount", "amount_paid", "receive_amount"]);
          const npAmt = getRowValue(row, ["Not Paid", "Unpaid", "Due", "Due Amount", "not_paid", "due_amount"]);

          return {
            id: idx,
            name,
            receiveAmount: rxAmt !== undefined ? Number(rxAmt) || 0 : "",
            notPaidAmount: npAmt !== undefined ? Number(npAmt) || 0 : "",
            isDuplicate: name ? nameCounts[name] > 1 : false,
            checked: true, // Checked by default
            rawRow: row,
          };
        });

        setParsedRows(rows);
        setParseError("");
      } catch (err) {
        console.error("Excel parse error:", err);
        setParseError("Could not read the Excel file. Please upload a valid file.");
      }
    };
    reader.readAsBinaryString(importFile);
  }, [importFile]);

  // Maxim prefill (no file needed): snapshot rows -> same preview shape.
  useEffect(() => {
    if (!maximLoaded || !Array.isArray(maximRows)) return;
    const rows = maximRows.map((r, idx) => ({
      id: `maxim-${idx}`,
      name: r.name || "",
      receiveAmount: Number(r.receiveAmount) || 0,
      notPaidAmount: Number(r.notPaidAmount) || 0,
      isDuplicate: false,
      checked: true,
      source: "maxim",
      rawRow: r.rawRow || {
        "Customer Name": r.name || "",
        "Receive Amount": Number(r.receiveAmount) || 0,
        "Not Paid": Number(r.notPaidAmount) || 0,
      },
    }));
    setParsedRows(rows);
    setParseError(rows.length ? "" : "No Maxim snapshot for this month — run Maxim Sync first.");
  }, [maximLoaded, maximRows]);

  const handleFetchMaxim = async () => {
    if (onFetchMaxim) await onFetchMaxim();
    setMaximLoaded(true);
  };

  const handleStartImport = () => {
    const checkedRows = parsedRows.filter((r) => r.checked);
    if (checkedRows.length === 0) {
      notify.error("Please select at least one record.");
      return;
    }

    // Rebuild Excel from checked rawRows
    const ws = XLSX.utils.json_to_sheet(checkedRows.map((r) => r.rawRow));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    
    // Create new File object
    const filteredFile = new File([wbout], importFile.name, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    onImport(filteredFile);
  };

  const duplicatesCount = parsedRows.filter((r) => r.isDuplicate).length;
  const displayedRows = showOnlyDuplicates
    ? parsedRows.filter((r) => r.isDuplicate)
    : parsedRows;

  return (
    <ModalWrap
      title="Import Excel Data"
      onClose={() => {
        if (!importing) onClose();
      }}
      size={parsedRows.length > 0 ? "lg" : "md"}
    >
      <div className="p-2">
        <div className="alert alert-info py-2 small mb-3">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <span>
              <i className="fas fa-info-circle me-2" />
              The Excel file must have <strong>&quot;Customer Name&quot;</strong>,{" "}
              <strong>&quot;Receive Amount&quot;</strong> and optional{" "}
              <strong>&quot;Not Paid&quot;</strong> columns.{" "}
              If <strong>&quot;Not Paid&quot;</strong> is given, it will carry
              forward as next month due.
            </span>
            <button
              className="btn btn-sm btn-success rounded-pill px-3 ms-2 flex-shrink-0"
              onClick={() =>
                import("../../../utils/excelGenerator").then((m) =>
                  m.downloadUserImportSample(),
                )
              }
            >
              <i className="fas fa-download me-1" />
              Sample Excel
            </button>
            {onFetchMaxim && (
              <button
                className="btn btn-sm btn-dark rounded-pill px-3 ms-2 flex-shrink-0"
                onClick={handleFetchMaxim}
                disabled={!!maximLoading}
                title="Prefill Receive/Not Paid from Maxim snapshot (no file needed)"
              >
                <i className={`fas ${maximLoading ? "fa-spinner fa-spin" : "fa-cloud-download-alt"} me-1`} />
                {maximLoading ? "Fetching…" : "Fetch from Maxim"}
              </button>
            )}
          </div>
        </div>

        <div className="row">
          <div className={parsedRows.length > 0 ? "col-md-4" : "col-12"}>
            <div className="mb-3">
              <label className="form-label small fw-bold">Select Month</label>
              <input
                type="month"
                className="form-control form-control-sm"
                value={importMonth}
                onChange={(e) => setImportMonth(e.target.value)}
                disabled={importing}
              />
            </div>
            <div className="mb-3">
              <label className="form-label small fw-bold">
                Upload Excel file (.xlsx, .xls)
              </label>
              <input
                type="file"
                className="form-control form-control-sm"
                accept=".xlsx, .xls"
                onChange={(e) => setImportFile(e.target.files[0])}
                disabled={importing}
              />
            </div>
          </div>

          {parsedRows.length > 0 && (
            <div className="col-md-8">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <span className="small fw-bold">
                  File Preview (Total: {parsedRows.length})
                </span>
                {duplicatesCount > 0 && (
                  <div className="form-check form-switch mb-0">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      id="showOnlyDupSwitch"
                      checked={showOnlyDuplicates}
                      onChange={(e) => setShowOnlyDuplicates(e.target.checked)}
                    />
                    <label className="form-check-label small fw-semibold text-danger" htmlFor="showOnlyDupSwitch">
                      Show duplicates only ({duplicatesCount})
                    </label>
                  </div>
                )}
              </div>

              {parseError && <div className="alert alert-danger py-1 small">{parseError}</div>}

              {duplicatesCount > 0 && (
                <div className="alert alert-warning py-1 px-2 mb-2 small d-flex align-items-center" style={{ fontSize: "0.78rem" }}>
                  <i className="fas fa-exclamation-triangle me-2 text-danger" />
                  <span>
                    <strong>Warning:</strong> duplicate customers found in the file (highlighted red). Check the rows you want to upload.
                  </span>
                </div>
              )}

              <div
                style={{
                  maxHeight: "260px",
                  overflowY: "auto",
                  border: "1px solid var(--bs-border-color, #dee2e6)",
                  borderRadius: "8px",
                }}
                className="mb-3 shadow-sm bg-body"
              >
                <table className="table table-sm table-hover mb-0 align-middle" style={{ fontSize: "0.82rem" }}>
                  <thead className="table-light sticky-top">
                    <tr>
                      <th style={{ width: "40px" }} className="text-center">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={displayedRows.length > 0 && displayedRows.every((r) => r.checked)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setParsedRows((prev) =>
                              prev.map((r) => {
                                if (showOnlyDuplicates && !r.isDuplicate) return r;
                                return { ...r, checked };
                              })
                            );
                          }}
                        />
                      </th>
                      <th>Customer Name</th>
                      <th className="text-end">Paid (Receive)</th>
                      <th className="text-end">Due (Not Paid)</th>
                      <th style={{ width: "95px" }} className="text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.map((row) => (
                      <tr
                        key={row.id}
                        style={{
                          backgroundColor: row.isDuplicate ? "rgba(220, 53, 69, 0.08)" : "transparent",
                        }}
                      >
                        <td className="text-center">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={row.checked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setParsedRows((prev) =>
                                prev.map((r) => (r.id === row.id ? { ...r, checked } : r))
                              );
                            }}
                          />
                        </td>
                        <td className={row.isDuplicate ? "text-danger fw-semibold" : ""}>
                          {row.name || <em className="text-muted">Unnamed</em>}
                        </td>
                        <td className="text-end font-monospace">
                          {row.receiveAmount !== "" ? `${row.receiveAmount} ৳` : "-"}
                        </td>
                        <td className="text-end font-monospace">
                          {row.notPaidAmount !== "" ? `${row.notPaidAmount} ৳` : "-"}
                        </td>
                        <td className="text-center">
                          {row.isDuplicate ? (
                            <span className="badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill py-0.5 px-2" style={{ fontSize: "0.68rem" }}>
                              Duplicate
                            </span>
                          ) : (
                            <span className="badge bg-success-subtle text-success border border-success-subtle rounded-pill py-0.5 px-2" style={{ fontSize: "0.68rem" }}>
                              OK
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="text-end pt-2 border-top">
          <button
            className="btn btn-sm btn-light me-2 rounded-pill px-3"
            onClick={onClose}
            disabled={importing}
          >
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary rounded-pill px-4"
            disabled={importing || !importFile || parsedRows.filter(r => r.checked).length === 0}
            onClick={handleStartImport}
          >
            {importing ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                Processing...
              </>
            ) : (
              <>
                <i className="fas fa-upload me-1" />
                Start Import
              </>
            )}
          </button>
        </div>
      </div>
    </ModalWrap>
  );
};

export default ImportModal;
