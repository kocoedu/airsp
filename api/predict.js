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

    // 1. 환경변수 누락 체크
    if (!apiKey || !endpoint) {
      console.error('환경변수 미설정:', { hasKey: !!apiKey, hasEndpoint: !!endpoint });
      return res.status(500).json({
        error: 'Vercel 환경변수(ROBOFLOW_API_KEY 또는 ROBOFLOW_ENDPOINT)가 설정되지 않았습니다.'
      });
    }

    const base64Data = image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

    let targetUrl = endpoint.trim();
    const separator = targetUrl.includes('?') ? '&' : '?';
    if (!targetUrl.includes('api_key=')) {
      targetUrl = `${targetUrl}${separator}api_key=${apiKey.trim()}`;
    }

    // Roboflow 호출
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: base64Data
    });

    const resultText = await response.text();

    if (!response.ok) {
      // Vercel 서버 로그에 Roboflow 실제 응답 메시지 기록
      console.error('Roboflow API 응답 에러:', response.status, resultText);
      return res.status(response.status).json({
        error: `Roboflow API 오류 (${response.status})`,
        details: resultText
      });
    }

    let resultData;
    try {
      resultData = JSON.parse(resultText);
    } catch (e) {
      return res.status(500).json({ error: 'Roboflow 응답 JSON 파싱 실패', raw: resultText });
    }

    // 예측 결과 파싱 (Workflow 및 일반 Inference API 호환)
    let topClass = 'unknown';
    let confidence = 0.0;

    // Roboflow Workflows / Classification / Object Detection 결과 대응
    if (resultData.predictions && Array.isArray(resultData.predictions) && resultData.predictions.length > 0) {
      topClass = resultData.predictions[0].class || resultData.predictions[0].label || 'unknown';
      confidence = resultData.predictions[0].confidence || 0.0;
    } else if (resultData.top) {
      topClass = resultData.top;
      confidence = resultData.confidence || 0.0;
    } else if (resultData.output && resultData.output.predictions) {
      // DINOv3 Workflow 구조
      const preds = resultData.output.predictions;
      if (Array.isArray(preds) && preds.length > 0) {
        topClass = preds[0].class || preds[0].label || 'unknown';
        confidence = preds[0].confidence || 0.0;
      }
    }

    return res.status(200).json({
      success: true,
      topClass: topClass.toLowerCase(),
      confidence: confidence,
      raw: resultData
    });

  } catch (error) {
    console.error('Predict API 서버 오류:', error);
    return res.status(500).json({
      error: '서버 내부 오류가 발생했습니다.',
      message: error.message
    });
  }
}
