import React from 'react';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-lg shadow p-8 max-w-lg w-full space-y-6 text-center">
        <h1 className="text-3xl font-bold text-gray-900">Virality</h1>
        <p className="text-gray-600">
          Login or sign up to access your company dashboard.
        </p>
        <div className="flex flex-col gap-3">
          <a
            href="/login"
            className="bg-indigo-600 text-white rounded-md px-4 py-2"
          >
            Login
          </a>
          <a
            href="/signup"
            className="border border-indigo-600 text-indigo-600 rounded-md px-4 py-2"
          >
            Sign up
          </a>
        </div>
        <div className="text-sm text-gray-500">
          Super admin? <a className="text-indigo-600" href="/super-admin/login">Login here</a>
        </div>
      </div>
    </div>
  );
}
