import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { createInternetRegistration, getInternetPackages } from '../services/internetRegistrationService';
import '../styles/InternetRegistration.css';
import BrandLogo from '../components/BrandLogo';

const defaultForm = {
  user_id_ip: '',
  application_date: '',
  connection_date: '',
  name_company: '',
  guardian_name: '',
  connection_address: '',
  thana: '',
  district: '',
  contact_number_1: '',
  contact_number_2: '',
  email: '',
  nationality: 'bangladeshi',
  nid_owner: 'own',
  nid_number: '',
  date_of_birth: '',
  occupation: '',
  reference: '',
  billing_contact_person: '',
  billing_address: '',
  billing_contact_number: '',
  installation_charge: '',
  billing_cycle_day: '',
  connection_expire_day: '',
  package_id: '',
  package_rate: '',
  monthly_bill: '',
  billing_id: '',
  billing_date: '',
  account_type: 'individual',
  package_type: 'regular',
  connectivity_type: 'shared',
  connection_type: 'fiber',
  connection_speed: '',
  real_ip_required: 'no',
  extra_hub: false
};

const getFirstWordSlug = (value) => {
  const firstWord = String(value || '').trim().split(/\s+/)[0] || '';
  return firstWord.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const normalizeBranch = (value) => String(value || '').trim().toLowerCase();

const InternetRegistration = () => {
  const [searchParams] = useSearchParams();
  const selectedFreeIdPoolId = searchParams.get('freeIdPoolId');
  const selectedUserIdIp = searchParams.get('userIdIp');
  const selectedBranchCode = searchParams.get('branchCode');
  const selectedBranchName = searchParams.get('branchName');

  const [form, setForm] = useState(() => ({
    ...defaultForm,
    user_id_ip: selectedFreeIdPoolId ? (selectedUserIdIp || '') : ''
  }));
  const [message, setMessage] = useState(null);
  const selectedOrTypedId = selectedFreeIdPoolId ? (selectedUserIdIp || '') : form.user_id_ip;
  const localUserIdPart = (() => {
    const base = getFirstWordSlug(form.name_company);
    const idPart = String(selectedOrTypedId || '').trim();
    if (!base || !idPart) return '';
    return `${base}${idPart}`;
  })();
  const generatedUserId = (() => {
    if (!localUserIdPart) return '';
    return `${localUserIdPart}@speednet`;
  })();
  const generatedPassword = (() => {
    const branchCode = normalizeBranch(selectedBranchCode);
    const branchName = normalizeBranch(selectedBranchName);
    const isCorporateOrShonadanga =
      branchCode === 'corp' || branchCode === 'shon' || branchName.includes('corporate') || branchName.includes('shonadanga');
    const isGollamariOrBoyra =
      branchCode === 'goll' || branchCode === 'boyr' || branchName.includes('gollamari') || branchName.includes('boyra');

    if (isCorporateOrShonadanga) return localUserIdPart ? `${localUserIdPart}321` : '';
    if (isGollamariOrBoyra) return '';
    return '';
  })();

  const createMutation = useMutation({
    mutationFn: createInternetRegistration,
    onSuccess: () => {
      setMessage({ type: 'success', text: 'Registration submitted successfully.' });
      setForm(() => ({
        ...defaultForm,
        user_id_ip: selectedFreeIdPoolId ? (selectedUserIdIp || '') : ''
      }));
    },
    onError: (error) => {
      setMessage({ type: 'danger', text: error?.response?.data?.message || 'Submission failed.' });
    }
  });

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const packagesQuery = useQuery({
    queryKey: ['internet-packages'],
    queryFn: getInternetPackages,
    staleTime: 5 * 60 * 1000
  });

  const packages = useMemo(
    () => Array.isArray(packagesQuery.data) ? packagesQuery.data : [],
    [packagesQuery.data]
  );
  const packageById = useMemo(() => {
    const map = new Map();
    packages.forEach((item) => {
      map.set(String(item.id), item);
    });
    return map;
  }, [packages]);

  const handlePackageSelect = (value) => {
    const selected = packageById.get(String(value));
    setForm((prev) => ({
      ...prev,
      package_id: value,
      package_rate: selected ? String(selected.price_bdt) : prev.package_rate,
      connection_speed: selected ? String(selected.speed_mbps) : prev.connection_speed,
      monthly_bill: selected && !prev.monthly_bill ? String(selected.price_bdt) : prev.monthly_bill
    }));
  };

  const buildNotes = () => {
    const selectedPackage = packageById.get(String(form.package_id));
    const lines = [
      `User ID/IP: ${form.user_id_ip || '-'}`,
      `Generated User ID: ${generatedUserId || '-'}`,
      `Generated Password: ${generatedPassword || '-'}`,
      `Guardian/Representative: ${form.guardian_name || '-'}`,
      `District: ${form.district || '-'}`,
      `Nationality: ${form.nationality || '-'}`,
      `NID Owner: ${form.nid_owner || '-'}`,
      `NID: ${form.nid_number || '-'}`,
      `DOB: ${form.date_of_birth || '-'}`,
      `Occupation: ${form.occupation || '-'}`,
      `Reference: ${form.reference || '-'}`,
      `Billing Contact Person: ${form.billing_contact_person || '-'}`,
      `Billing Address: ${form.billing_address || '-'}`,
      `Billing Contact Number: ${form.billing_contact_number || '-'}`,
      `Installation Charge: ${form.installation_charge || '-'}`,
      `Billing Cycle Day: ${form.billing_cycle_day || '-'}`,
      `Connection Expire Day: ${form.connection_expire_day || '-'}`,
      `Package Name: ${selectedPackage ? selectedPackage.name : '-'}`,
      `Package Rate: ${form.package_rate || '-'}`,
      `Monthly Bill: ${form.monthly_bill || '-'}`,
      `Billing Date: ${form.billing_date || '-'}`,
      `Account Type: ${form.account_type || '-'}`,
      `Package Type: ${form.package_type || '-'}`,
      `Connectivity Type: ${form.connectivity_type || '-'}`,
      `Connection Type: ${form.connection_type || '-'}`,
      `Connection Speed: ${form.connection_speed || '-'} Mbps`,
      `Real IP Required: ${form.real_ip_required || '-'}`,
      `Extra Hub: ${form.extra_hub ? 'yes' : 'no'}`
    ];
    return lines.join('\n');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate({
      applicant_name: form.name_company,
      phone: form.contact_number_1,
      alternate_phone: form.contact_number_2 || null,
      email: form.email || null,
      area: form.thana,
      address: form.connection_address,
      preferred_package_mbps: form.connection_speed ? Number(form.connection_speed) : null,
      connection_type: form.account_type,
      preferred_contact_time: '',
      notes: buildNotes(),
      user_id_ip: form.user_id_ip || null,
      internet_user_id: generatedUserId || null,
      internet_password: generatedPassword || null,
      application_date: form.application_date || null,
      connection_date: form.connection_date || null,
      guardian_name: form.guardian_name || null,
      district: form.district || null,
      nid_number: form.nid_number || null,
      date_of_birth: form.date_of_birth || null,
      occupation: form.occupation || null,
      reference_name: form.reference || null,
      billing_contact_person: null,
      billing_address: null,
      billing_contact_number: null,
      installation_charge: form.installation_charge || null,
      billing_cycle_day: form.billing_cycle_day ? Number(form.billing_cycle_day) : null,
      connection_expire_day: form.connection_expire_day ? Number(form.connection_expire_day) : null,
      package_id: form.package_id ? Number(form.package_id) : null,
      package_rate: form.package_rate || null,
      monthly_bill: form.monthly_bill || null,
      billing_id: null,
      billing_date: form.billing_date || null,
      free_id_pool_id: selectedFreeIdPoolId ? Number(selectedFreeIdPoolId) : null,
      account_type: form.account_type || null,
      package_type: form.package_type || null,
      connectivity_type: form.connectivity_type || null,
      connection_media_type: form.connection_type || null,
      real_ip_required: form.real_ip_required || 'no',
      extra_hub: !!form.extra_hub
    });
  };

  return (
    <div className="internet-registration-page">
      <form onSubmit={handleSubmit} className="paper-form">
        <div className="free-id-topbar">
          <Link className="btn btn-sm btn-outline-primary" to="/internet-registration/free-ids">
            Browse Free IDs
          </Link>
          {selectedFreeIdPoolId && (
            <span className="badge text-bg-info">
              Selected: {selectedBranchName || selectedBranchCode || 'Branch'} | {selectedUserIdIp || 'N/A'}
            </span>
          )}
        </div>
        <header className="form-banner">
          <div className="brand-block">
            <BrandLogo className="speednet-logo" alt="Speed Net" />
          </div>
          <div className="title-block">
            <h2>Application Form</h2>
            <p>(to be filled in block letters)</p>
          </div>
        </header>

        {message && <div className={`alert alert-${message.type} paper-alert`}>{message.text}</div>}

        <section className="row-grid top-meta">
          <label>
            User ID / IP Number
            <input
              className="form-control"
              value={selectedOrTypedId}
              onChange={(e) => handleChange('user_id_ip', e.target.value)}
              readOnly={!!selectedFreeIdPoolId}
            />
          </label>
          <label>
            User ID
            <input className="form-control" value={generatedUserId} readOnly />
          </label>
          <label>
            Password
            <input className="form-control" value={generatedPassword} readOnly placeholder="Auto generated by branch" />
          </label>
          <label>
            Application Date
            <input type="date" className="form-control" value={form.application_date} onChange={(e) => handleChange('application_date', e.target.value)} />
          </label>
          <label>
            Connection Date
            <input type="date" className="form-control" value={form.connection_date} onChange={(e) => handleChange('connection_date', e.target.value)} />
          </label>
        </section>

        <h3 className="section-title">User Details</h3>
        <section className="row-grid three-col">
          <label className="span-2">
            Name / Company
            <input className="form-control" value={form.name_company} onChange={(e) => handleChange('name_company', e.target.value)} required />
          </label>
          <label>
            Occupation
            <input className="form-control" value={form.occupation} onChange={(e) => handleChange('occupation', e.target.value)} />
          </label>

          <label className="span-3">
            Father/Husband/Representative Name
            <input className="form-control" value={form.guardian_name} onChange={(e) => handleChange('guardian_name', e.target.value)} />
          </label>

          <label className="span-3">
            Connection Address
            <input className="form-control" value={form.connection_address} onChange={(e) => handleChange('connection_address', e.target.value)} required />
          </label>

          <label>
            Thana
            <input className="form-control" value={form.thana} onChange={(e) => handleChange('thana', e.target.value)} required />
          </label>
          <label>
            District
            <input className="form-control" value={form.district} onChange={(e) => handleChange('district', e.target.value)} />
          </label>
          <label>
            Nationality
            <select className="form-control" value={form.nationality} onChange={(e) => handleChange('nationality', e.target.value)}>
              <option value="bangladeshi">Bangladeshi</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            NID Owner
            <select className="form-control" value={form.nid_owner} onChange={(e) => handleChange('nid_owner', e.target.value)}>
              <option value="own">Own</option>
              <option value="father">Father</option>
              <option value="mother">Mother</option>
            </select>
          </label>
          <label>
            NID Number
            <input className="form-control" value={form.nid_number} onChange={(e) => handleChange('nid_number', e.target.value)} />
          </label>

          <label>
            Contact Number 1
            <input className="form-control" value={form.contact_number_1} onChange={(e) => handleChange('contact_number_1', e.target.value)} required />
          </label>
          <label>
            Contact Number 2
            <input className="form-control" value={form.contact_number_2} onChange={(e) => handleChange('contact_number_2', e.target.value)} />
          </label>
          <label>
            Date of Birth
            <input type="date" className="form-control" value={form.date_of_birth} onChange={(e) => handleChange('date_of_birth', e.target.value)} />
          </label>

          <label className="span-2">
            E-mail
            <input type="email" className="form-control" value={form.email} onChange={(e) => handleChange('email', e.target.value)} />
          </label>
          <label>
            Reference
            <input className="form-control" value={form.reference} onChange={(e) => handleChange('reference', e.target.value)} />
          </label>
        </section>

        <h3 className="section-title">Billing Details</h3>
        <section className="row-grid three-col">
          <label>
            Installation Charge
            <input type="number" className="form-control" value={form.installation_charge} onChange={(e) => handleChange('installation_charge', e.target.value)} />
          </label>
          <label>
            Billing Cycle Day
            <select
              className="form-control"
              value={form.billing_cycle_day}
              onChange={(e) => {
                const value = e.target.value;
                const expireDay = value === '1' ? '3' : value === '5' ? '8' : '';
                setForm((prev) => ({
                  ...prev,
                  billing_cycle_day: value,
                  connection_expire_day: expireDay
                }));
              }}
            >
              <option value="">Select billing day</option>
              <option value="1">1st of month</option>
              <option value="5">5th of month</option>
            </select>
          </label>
          <label>
            Connection Expire Day (info)
            <input className="form-control" value={form.connection_expire_day} readOnly placeholder="Auto based on billing day" />
          </label>
          <label>
            Package Name
            <select className="form-control" value={form.package_id} onChange={(e) => handlePackageSelect(e.target.value)}>
              <option value="">Select package</option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name} — {pkg.speed_mbps} Mbps — {pkg.price_bdt} BDT/month (VAT included)
                </option>
              ))}
            </select>
          </label>
          <label>
            Package Rate
            <input type="number" className="form-control" value={form.package_rate} onChange={(e) => handleChange('package_rate', e.target.value)} />
          </label>

          <label>
            Monthly Bill (this month)
            <input type="number" className="form-control" value={form.monthly_bill} onChange={(e) => handleChange('monthly_bill', e.target.value)} />
          </label>
          <label>
            Billing Date
            <input type="date" className="form-control" value={form.billing_date} onChange={(e) => handleChange('billing_date', e.target.value)} />
          </label>
        </section>

        <h3 className="section-title">Technical Details</h3>
        <section className="row-grid three-col">
          <fieldset className="check-group">
            <legend>Account Type</legend>
            <label><input type="radio" checked={form.account_type === 'individual'} onChange={() => handleChange('account_type', 'individual')} /> Individual Standard</label>
            <label><input type="radio" checked={form.account_type === 'corporate'} onChange={() => handleChange('account_type', 'corporate')} /> Corporate Standard</label>
            <label><input type="radio" checked={form.account_type === 'govt'} onChange={() => handleChange('account_type', 'govt')} /> Government Organization</label>
          </fieldset>

          <fieldset className="check-group">
            <legend>Package Type</legend>
            <label><input type="radio" checked={form.package_type === 'regular'} onChange={() => handleChange('package_type', 'regular')} /> Regular</label>
            <label><input type="radio" checked={form.package_type === 'ek-desh-ek-rate'} onChange={() => handleChange('package_type', 'ek-desh-ek-rate')} /> Ek Desh Ek Rate</label>
          </fieldset>

          <label>
            Connection Speed (Mbps)
            <input type="number" className="form-control" value={form.connection_speed} onChange={(e) => handleChange('connection_speed', e.target.value)} />
          </label>

          <fieldset className="check-group">
            <legend>Connectivity Type</legend>
            <label><input type="radio" checked={form.connectivity_type === 'shared'} onChange={() => handleChange('connectivity_type', 'shared')} /> Shared</label>
            <label><input type="radio" checked={form.connectivity_type === 'dedicated'} onChange={() => handleChange('connectivity_type', 'dedicated')} /> Dedicated</label>
          </fieldset>

          <fieldset className="check-group">
            <legend>Connection Type</legend>
            <label><input type="radio" checked={form.connection_type === 'fiber'} onChange={() => handleChange('connection_type', 'fiber')} /> Fiber</label>
            <label><input type="radio" checked={form.connection_type === 'cat5'} onChange={() => handleChange('connection_type', 'cat5')} /> Cat 5</label>
            <label><input type="radio" checked={form.connection_type === 'cat6'} onChange={() => handleChange('connection_type', 'cat6')} /> Cat 6</label>
          </fieldset>

          <fieldset className="check-group">
            <legend>Real IP Requirement</legend>
            <label><input type="radio" checked={form.real_ip_required === 'yes'} onChange={() => handleChange('real_ip_required', 'yes')} /> Yes</label>
            <label><input type="radio" checked={form.real_ip_required === 'no'} onChange={() => handleChange('real_ip_required', 'no')} /> No</label>
            <label><input type="checkbox" checked={form.extra_hub} onChange={(e) => handleChange('extra_hub', e.target.checked)} /> Extra Hub</label>
          </fieldset>
        </section>

        <footer className="signature-row">
          <div>Authorized Signature</div>
          <div>Signature (Marketing Manager)</div>
          <div>Signature (Executive)</div>
          <div>Customer Signature</div>
        </footer>

        <div className="submit-row">
          <button className="btn btn-primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Submitting...' : 'Submit Application'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default InternetRegistration;
