'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { account, getCurrentUser } from '@/lib/appwrite-client';

interface DashboardStats {
  totalCustomers: number;
  activeCampaigns: number;
  pendingReviews: number;
  conversationToday: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalCustomers: 0,
    activeCampaigns: 0,
    pendingReviews: 0,
    conversationToday: 0,
  });

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
      } catch (error) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    try {
      await account.deleteSession('current');
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">TravAI Dashboard</h1>
            <p className="text-sm text-gray-600 mt-1">Welcome back, {user?.name || 'User'}</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          {/* Customers Card */}
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">Total Customers</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {stats.totalCustomers}
                </p>
              </div>
              <div className="text-4xl text-blue-100">👥</div>
            </div>
            <p className="text-xs text-gray-500 mt-4">+2 this month</p>
          </div>

          {/* Campaigns Card */}
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">Active Campaigns</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {stats.activeCampaigns}
                </p>
              </div>
              <div className="text-4xl text-green-100">📢</div>
            </div>
            <p className="text-xs text-gray-500 mt-4">+1 in draft</p>
          </div>

          {/* Reviews Card */}
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-purple-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">Pending Reviews</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {stats.pendingReviews}
                </p>
              </div>
              <div className="text-4xl text-purple-100">⭐</div>
            </div>
            <p className="text-xs text-gray-500 mt-4">Need replies</p>
          </div>

          {/* Conversations Card */}
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-orange-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">Today's Conversations</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {stats.conversationToday}
                </p>
              </div>
              <div className="text-4xl text-orange-100">💬</div>
            </div>
            <p className="text-xs text-gray-500 mt-4">WhatsApp messages</p>
          </div>
        </div>

        {/* Features Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* WhatsApp Chat Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <span className="text-green-500 mr-2">💬</span>
              WhatsApp Integration
            </h3>
            <p className="text-gray-600 text-sm mb-4">
              AI-powered customer conversations and automated replies via WhatsApp.
            </p>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>✓ Receive & send messages</li>
              <li>✓ AI-powered replies</li>
              <li>✓ Conversation history</li>
              <li>✓ Customer segmentation</li>
            </ul>
            <button className="w-full px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors">
              View Conversations
            </button>
          </div>

          {/* Campaigns Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <span className="text-blue-500 mr-2">📢</span>
              Marketing Campaigns
            </h3>
            <p className="text-gray-600 text-sm mb-4">
              Create and manage bulk WhatsApp marketing campaigns with advanced targeting.
            </p>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>✓ Bulk messaging</li>
              <li>✓ Customer targeting</li>
              <li>✓ Templates</li>
              <li>✓ Analytics</li>
            </ul>
            <button className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors">
              Create Campaign
            </button>
          </div>

          {/* GBP Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <span className="text-orange-500 mr-2">🌐</span>
              Google Business Posts
            </h3>
            <p className="text-gray-600 text-sm mb-4">
              Generate SEO-optimized posts for Google Business Profile and manage reviews.
            </p>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>✓ AI-generated posts</li>
              <li>✓ Review management</li>
              <li>✓ Auto-replies</li>
              <li>✓ SEO optimization</li>
            </ul>
            <button
              onClick={() => router.push('/dashboard/gbp')}
              className="w-full px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Manage GBP
            </button>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
          <div className="space-y-4">
            <div className="flex items-center p-4 bg-gray-50 rounded-lg">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-lg">📨</div>
              <div className="ml-4 flex-1">
                <p className="font-medium text-gray-900">Campaign Sent</p>
                <p className="text-sm text-gray-600">Product announcement to 245 customers</p>
              </div>
              <p className="text-xs text-gray-500">2 hours ago</p>
            </div>

            <div className="flex items-center p-4 bg-gray-50 rounded-lg">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-lg">⭐</div>
              <div className="ml-4 flex-1">
                <p className="font-medium text-gray-900">New Review Reply</p>
                <p className="text-sm text-gray-600">Generated and posted on Google Business</p>
              </div>
              <p className="text-xs text-gray-500">5 hours ago</p>
            </div>

            <div className="flex items-center p-4 bg-gray-50 rounded-lg">
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center text-lg">🔔</div>
              <div className="ml-4 flex-1">
                <p className="font-medium text-gray-900">New Customer</p>
                <p className="text-sm text-gray-600">John Doe started WhatsApp conversation</p>
              </div>
              <p className="text-xs text-gray-500">1 day ago</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
