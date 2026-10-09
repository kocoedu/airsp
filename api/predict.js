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
        error: 'Vercel 환경변수(ROBOFLOW_API_KEY 또는 ROBOFLOW_ENDPOINT)가 설정되지 않았습니다.'
      });
    }

    // Endpoint URL 및 API Key 파라미터 정리
    let targetUrl = endpoint.trim();
    const separator = targetUrl.includes('?') ? '&' : '?';
    if (!targetUrl.includes('api_key=')) {
      targetUrl = `${targetUrl}${separator}api_key=${apiKey.trim()}`;
    }

    // Workflow / Inference API 유형 자동 감지 및 JSON Payload 구축
    const isWorkflow = targetUrl.includes('/workflows/') || targetUrl.includes('/outline.');
    
    // Base64 Data URL 전체 준비 (data:image/jpeg;base64,... 형태 유지)
    const formattedBase64Image = image.startsWith('data:') 
      ? image 
      : `data:image/jpeg;base64,${image}`;

    let requestBody;
    let headers = { 'Content-Type': 'application/json' };

    if (isWorkflow) {
      // Roboflow Cloud Workflow 규격 (DINOv3 Workflow 포함)
      requestBody = JSON.stringify({
        inputs: {
          image: {
            type: 'url',
            value: formattedBase64Image
          }
        }
      });
    } else {
      // 일반 Roboflow Hosted Inference API 규격
      requestBody = JSON.stringify({
        image: {
          type: 'base64',
          value: formattedBase64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '')
        }
      });
    }

    // Roboflow Cloud API 호출
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: headers,
      body: requestBody
    });

    const resultText = await response.text();

    if (!response.ok) {
      console.error('Roboflow API HTTP Error:', response.status, resultText);
      
      // Workflow JSON 호출 실패 시 2차 Fallback (x-www-form-urlencoded 전송 시도)
      if (response.status === 422 && !isWorkflow) {
        const rawBase64 = formattedBase64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
        const fallbackResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: rawBase64
        });
        const fallbackText = await fallbackResponse.text();
        if (fallbackResponse.ok) {
          const fallbackData = JSON.parse(fallbackText);
          return parseAndReturnResult(res, fallbackData);
        }
      }

      return res.status(response.status).json({
        error: `Roboflow API 오류 (${response.status})`,
        details: resultText
      });
    }

    let resultData;
    try {
      resultData = JSON.parse(resultText);
    } catch (e) {
      return res.status(500).json({ error: 'Roboflow 응답 파싱 실패', raw: resultText });
    }

    return parseAndReturnResult(res, resultData);

  } catch (error) {
    console.error('Predict API Error:', error);
    return res.status(500).json({
      error: '서버 내부 오류가 발생했습니다.',
      message: error.message
    });
  }
}

// 예측 결과 구조 분석 및 파싱 함수
function parseAndReturnResult(res, resultData) {
  let topClass = 'unknown';
  let confidence = 0.0;

  // 1. Workflow Output 스키마 파싱
  if (resultData.outputs && Array.isArray(resultData.outputs) && resultData.outputs.length > 0) {
    const firstOutput = resultData.outputs[0];
    const predictions = firstOutput.predictions || firstOutput.output?.predictions || firstOutput.predictions?.predictions;
    
    if (predictions && Array.isArray(predictions) && predictions.length > 0) {
      topClass = predictions[0].class || predictions[0].label || predictions[0].top || 'unknown';
      confidence = predictions[0].confidence || predictions[0].score || 0.0;
    } else if (firstOutput.top_class || firstOutput.prediction) {
      topClass = firstOutput.top_class || firstOutput.prediction;
      confidence = firstOutput.confidence || 0.0;
    }
  } 
  // 2. Standard Detection / Classification 스키마 파싱
  else if (resultData.predictions && Array.isArray(resultData.predictions) && resultData.predictions.length > 0) {
    topClass = resultData.predictions[0].class || resultData.predictions[0].label || 'unknown';
    confidence = resultData.predictions[0].confidence || 0.0;
  } else if (resultData.top) {
    topClass = resultData.top;
    confidence = resultData.confidence || 0.0;
  }

  return res.status(200).json({
    success: true,
    topClass: String(topClass).toLowerCase(),
    confidence: Number(confidence),
    raw: resultData
  });
}
