import apiClient from '../config/axiosConfig';

/**
 * Ahadix Next-Gen Solution - Admin Service
 * ড্যাশবোর্ডের প্রয়োজনীয় সকল স্ট্যাটিস্টিক্স এবং লিস্ট নিয়ে আসার ফাংশন
 */
export const getAdminDashboardData = async () => {
  try {
    const response = await apiClient.get('/api/dashboard/admin');
    
    // সার্ভার থেকে ডেটা আসলে তা রিটার্ন করছি
    if (response.data) {
      return response.data;
    }
    
    throw new Error('No data received from server');

  } catch (error) {
    // এরর হ্যান্ডলিং আরও ডিটেইল করা হয়েছে যাতে ডিবাগ করতে সুবিধা হয়
    const errorMessage = error.response?.data?.message || error.message || 'Failed to load dashboard data';
    
    console.error('❌ Dashboard Fetch Error:', {
      status: error.response?.status,
      message: errorMessage
    });

    // এররটি থ্রো করা হচ্ছে যাতে UI-তে (AdminDashboard.jsx) এটি হ্যান্ডেল করা যায়
    throw new Error(errorMessage);
  }
};

/**
 * অতিরিক্ত টিপস: ভবিষ্যতে যদি নির্দিষ্ট কোনো অ্যাকশন বা ফিল্টার যোগ করতে চান
 * যেমন: নির্দিষ্ট মাসের রিপোর্ট দেখা
 */
export const getFilteredDashboardData = async (month, year) => {
  try {
    const response = await apiClient.get(`/api/dashboard/admin?month=${month}&year=${year}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching filtered data:', error);
    throw error;
  }
};