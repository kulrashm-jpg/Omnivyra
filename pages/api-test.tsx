import React from 'react';

export default function APITest() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">API Test Results</h1>
      <div className="bg-gray-100 p-4 rounded">
        <pre id="api-result">Click button below to test API...</pre>
      </div>
      <button 
        onClick={testAPI}
        className="mt-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
      >
        Test API Connection
      </button>
    </div>
  );

  async function testAPI() {
    const resultElement = document.getElementById('api-result');
    resultElement!.textContent = 'Testing API...';
    
    try {
      const response = await fetch('/api/campaigns');
      const data = await response.json();
      
      resultElement!.textContent = JSON.stringify({
        status: response.status,
        success: data.success,
        campaignCount: data.campaigns?.length || 0,
        firstCampaign: data.campaigns?.[0] || 'No campaigns'
      }, null, 2);
    } catch (error) {
      resultElement!.textContent = `Error: ${error.message}`;
    }
  }
}







