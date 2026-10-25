import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getNotice } from '../services/noticeService';
import { getLatestMonthlyAward } from '../services/employeeOfTheMonthService';
import '../styles/NoticeTicker.css';

const NoticeTicker = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['activeNotice'],
    queryFn: getNotice,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const { data: latestAward } = useQuery({
    queryKey: ['latestEmployeeOfTheMonth'],
    queryFn: getLatestMonthlyAward,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  if ((isLoading && !latestAward) || (error && !latestAward) || (!data?.notice && !latestAward)) return null;

  const notice = data?.notice || '';
  const awardMonth = latestAward?.award_month
    ? new Date(`${latestAward.award_month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="news-ticker" style={{ flexWrap: 'wrap', rowGap: 8 }}>
      <div className="ticker-title">
        <i className="fas fa-bullhorn me-2"></i> Latest Updates
      </div>
      <div className="ticker-content">
        {latestAward && (
          <div role="status" style={{ color: '#075985', marginBottom: notice ? 4 : 0, whiteSpace: 'normal' }}>
            <i className="fas fa-award me-2" aria-hidden="true"></i>
            Employee of the Month — {latestAward.employee_name}, {awardMonth}
          </div>
        )}
        {/* CSS Animation replaces <marquee> */}
        {notice && <div className="ticker-scroll">{notice}</div>}
      </div>
    </div>
  );
};

export default NoticeTicker;
