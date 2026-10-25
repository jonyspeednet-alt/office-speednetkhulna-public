import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import apiClient from '../config/axiosConfig';
import moment from 'moment';
import html2canvas from 'html2canvas';
import BrandLogo from '../components/BrandLogo';
import { notify } from '../utils/notify';
import '../styles/AdminDashboard.css';

const ApprovalLetter = () => {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const letterRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  const bnDays = {
    'Saturday': 'শনিবার',
    'Sunday': 'রবিবার',
    'Monday': 'সোমবার',
    'Tuesday': 'মঙ্গলবার',
    'Wednesday': 'বুধবার',
    'Thursday': 'বৃহস্পতিবার',
    'Friday': 'শুক্রবার'
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await apiClient.get(`/api/approvals/${id}`);
        setData(response.data);
      } catch (error) {
        console.error('Error fetching approval data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const downloadAsImage = async () => {
    if (!letterRef.current) return;
    setDownloading(true);

    try {
      const canvas = await html2canvas(letterRef.current, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
      });

      const image = canvas.toDataURL("image/png", 1.0);
      const link = document.createElement('a');
      link.download = `Approval-${data.info.employee_id}.png`;
      link.href = image;
      link.click();
    } catch (error) {
      console.error("Image generation failed:", error);
      notify.error("Failed to download image.");
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <div className="text-center py-5">Loading...</div>;
  if (!data) return <div className="text-center py-5 text-danger">Approval letter not found.</div>;

  const { info, leaves, joining_info } = data;
  const isMulti = leaves.length > 1;

  return (
    <div className="approval-letter-wrapper" style={{ background: '#f0f0f0', minHeight: '100vh', padding: '20px 0' }}>
      <div className="action-bar no-print" style={{ position: 'fixed', top: '20px', right: '20px', display: 'flex', gap: '10px', zIndex: 1000 }}>
        <button className="btn btn-primary rounded-pill px-4 shadow" onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i> Print / PDF
        </button>
        <button className="btn btn-success rounded-pill px-4 shadow" onClick={downloadAsImage} disabled={downloading}>
          <i className={downloading ? "fas fa-spinner fa-spin me-2" : "fas fa-image me-2"}></i>
          {downloading ? 'Processing...' : 'Download PNG'}
        </button>
      </div>

      <div 
        ref={letterRef}
        className="letter-page" 
        style={{ 
          width: '210mm', 
          minHeight: '297mm', 
          padding: '15mm 20mm', 
          margin: '0 auto', 
          background: 'white', 
          boxShadow: '0 0 10px rgba(0,0,0,0.1)', 
          position: 'relative', 
          boxSizing: 'border-box', 
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "'Hind Siliguri', sans-serif"
        }}
      >
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&display=swap');
            @media print {
              body { background: white !important; padding: 0 !important; }
              .no-print { display: none !important; }
              .letter-page { margin: 0 !important; width: 100% !important; height: auto !important; box-shadow: none !important; }
              @page { size: A4; margin: 10mm; }
            }
          `}
        </style>

        <BrandLogo alt="watermark" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '450px', opacity: '0.05', zIndex: 0, pointerEvents: 'none' }} />
        
        <div className="header" style={{ textAlign: 'center', borderBottom: '2px solid #4318ff', paddingBottom: '10px', marginBottom: '20px', position: 'relative', zIndex: 1 }}>
          <BrandLogo alt="Logo" style={{ height: '100px', width: 'auto', marginBottom: '10px', objectFit: 'contain' }} />
          <h3 style={{ margin: 0, color: '#333', fontSize: '24px' }}>স্পিড নেট খুলনা</h3>
          <p style={{ margin: '2px 0', color: '#666', fontSize: '14px' }}>অফিসিয়াল ছুটির অনুমতি পত্র</p>
        </div>

        <div className="content" style={{ flex: 1, lineHeight: '1.8', color: '#333', fontSize: '16px', textAlign: 'justify', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', fontSize: '14px' }}>
            <div>সূত্র: SNKHL/HR/{moment().year()}/{String(info.id).padStart(4, '0')}</div>
            <div>তারিখ: <strong>{moment(info.action_at).format('DD MMM, YYYY')}</strong></div>
          </div>
          
          <p>বরাবর,<br />
             <strong>{info.full_name}</strong><br />
             পদবী: {info.designation}<br />
             বিভাগ: {info.department}
          </p>

          <p style={{ marginTop: '5px' }}>
            আপনার আবেদনের প্রেক্ষিতে জানানো যাচ্ছে যে, কর্তৃপক্ষের সিদ্ধান্ত অনুযায়ী আপনার 
            {isMulti ? ' নিম্নোক্ত একাধিক ছুটির আবেদনসমূহ ' : ' নিম্নোক্ত ছুটির আবেদনটি '} 
            অনুমোদিত হয়েছে:
          </p>

          <table style={{ width: '100%', margin: '20px 0', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9f9f9' }}>
                <th style={{ padding: '12px', border: '1px solid #ddd', textAlign: 'left' }}>ক্রমিক</th>
                <th style={{ padding: '12px', border: '1px solid #ddd', textAlign: 'left' }}>ছুটির ধরণ</th>
                <th style={{ padding: '12px', border: '1px solid #ddd', textAlign: 'left' }}>তারিখ</th>
                <th style={{ padding: '12px', border: '1px solid #ddd', textAlign: 'left' }}>অনুমোদিত দিন</th>
              </tr>
            </thead>
            <tbody>
              {leaves.map((lv, idx) => (
                <tr key={lv.id}>
                  <td style={{ padding: '12px', border: '1px solid #ddd' }}>{idx + 1}</td>
                  <td style={{ padding: '12px', border: '1px solid #ddd' }}>{lv.type_name} {lv.is_half ? `(${lv.half_day_period === 'Morning' ? 'প্রথম ভাগ' : 'দ্বিতীয় ভাগ'})` : ''}</td>
                  <td style={{ padding: '12px', border: '1px solid #ddd' }}>
                    {lv.is_half ? moment(lv.start_date).format('DD MMM, YYYY') : `${moment(lv.start_date).format('DD MMM, YYYY')} - ${moment(lv.end_date).format('DD MMM, YYYY')}`}
                  </td>
                  <td style={{ padding: '12px', border: '1px solid #ddd' }}>{lv.day_count} দিন</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p>
            {isMulti ? 'উপরোক্ত সব ছুটি শেষে আপনাকে ' : 'ছুটি শেষে আপনাকে '}
            আগামী <strong>{moment(joining_info.date).format('DD/MM/YYYY')}</strong> তারিখ <strong>({bnDays[moment(joining_info.date).format('l')]}{joining_info.desc === 'Second Half' ? ' - দিনের দ্বিতীয় ভাগে' : ''})</strong> যথাসময়ে কর্মস্থলে উপস্থিত হওয়ার জন্য অনুরোধ করা হলো।
          </p>
          <p>ভবিষ্যতে যেকোনো প্রয়োজনে কর্তৃপক্ষের সাথে যোগাযোগ করার পরামর্শ দেওয়া হলো। আপনার সুস্থতা কামনা করছি।</p>
        </div>

        <div className="footer" style={{ marginTop: 'auto', paddingTop: '30px', paddingBottom: '20px', position: 'relative', zIndex: 1 }}>
          <div className="signature" style={{ float: 'right', textAlign: 'center', width: '250px', position: 'relative' }}>
            {info.digital_seal && (
              <img 
                src={`/uploads/seals/${info.digital_seal}`} 
                alt="Seal" 
                style={{ width: '150px', height: 'auto', position: 'absolute', bottom: '45px', left: '50%', transform: 'translateX(-50%)', opacity: 0.9, zIndex: 1 }} 
              />
            )}

            <div style={{ marginTop: '60px', position: 'relative', zIndex: 2 }}>
              <hr style={{ border: 0, borderTop: '1px solid #000', marginBottom: '5px' }} />
              <strong>{info.admin_name}</strong><br />
              <small>ব্যবস্থাপনা কর্তৃপক্ষ</small><br />
              <small>স্পিড নেট খুলনা</small>
            </div>
          </div>
        </div>

        <div className="letter-footer-info" style={{ borderTop: '1px solid #eee', paddingTop: '10px', marginTop: '20px', textAlign: 'center', fontSize: '11px', color: '#888', position: 'relative', zIndex: 1 }}>
          Speed Net Khulna | Head Office: Notun Bazar, Khulna | Email: info@speednetkhulna.com | Web: www.speednetkhulna.com
        </div>
      </div>
    </div>
  );
};

export default ApprovalLetter;
