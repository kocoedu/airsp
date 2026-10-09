// api/predict.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: '이미지 데이터가 전달되지 않았습니다.' });
    }

    const apiKey = process.env.ROBOFLOW_API_KEY;
    const endpoint = process.env.ROBOFLOW_ENDPOINT;

    if (!apiKey || !endpoint) {
      return res.status(500).json({
        error: 'Vercel 환경변수(ROBOFLOW_API_KEY, ROBOFLOW_ENDPOINT)가 설정되지 않았습니다.'
      });
    }

    // Base64 데이터 헤더 정리
    const base64Data = image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

    // Endpoint URL에 API Key 연결
    let targetUrl = endpoint;
    const separator = targetUrl.includes('?') ? '&' : '?';
    if (!targetUrl.includes('api_key=')) {
      targetUrl = `${targetUrl}${separator}api_key=${apiKey}`;
    }

    // Roboflow HTTP POST 요청 (Raw Base64)
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: base64Data
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: 'Roboflow API 오류 발생',
        details: errorText
      });
    }

    const resultData = await response.json();

    // 클래스 예측 파싱 (rock, paper, scissors)
    let topClass = 'unknown';
    let confidence = 0.0;

    if (resultData.predictions && Array.isArray(resultData.predictions) && resultData.predictions.length > 0) {
      topClass = resultData.predictions[0].class || resultData.predictions[0].label;
      confidence = resultData.predictions[0].confidence || 0.0;
    } else if (resultData.top) {
      topClass = resultData.top;
      confidence = resultData.confidence || 0.0;
    }

    return res.status(200).json({
      success: true,
      topClass: topClass.toLowerCase(),
      confidence: confidence,
      raw: resultData
    });

  } catch (error) {
    console.error('Predict API Error:', error);
    return res.status(500).json({
      error: '서버 내부 오류가 발생했습니다.',
      message: error.message
    });
  }
}