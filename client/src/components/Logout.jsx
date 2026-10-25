import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { logoutUser } from '../services/authService';

const Logout = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const performLogout = async () => {
      await logoutUser();
      // Clear all React Query cache on logout
      queryClient.clear();
      // Redirect to login page after cleanup
      navigate('/login', { replace: true });
    };
    
    performLogout();
  }, [navigate, queryClient]);

  return (
    <div className="d-flex justify-content-center align-items-center vh-100">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">Logging out...</span>
      </div>
    </div>
  );
};

export default Logout;