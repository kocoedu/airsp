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

    // 환경변수 다듬기 (공백 및 따옴표 제거)
    const apiKey = (process.env.ROBOFLOW_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    let rawEndpoint = (process.env.ROBOFLOW_ENDPOINT || '').trim().replace(/^["']|["']$/g, '');

    if (!apiKey || !rawEndpoint) {
      return res.status(500).json({
        error: 'Vercel 환경변수(ROBOFLOW_API_KEY 또는 ROBOFLOW_ENDPOINT)가 설정되지 않았습니다.'
      });
    }

    // URL에서 기존 쿼리스트링 분리
    const urlObj = new URL(rawEndpoint);
    urlObj.searchParams.delete('api_key'); // 기존 api_key 파라미터가 있다면 제거 후 순수 URL 생성
    const cleanEndpoint = urlObj.toString();

    const formattedBase64Image = image.startsWith('data:') 
      ? image 
      : `data:image/jpeg;base64,${image}`;

    const isWorkflow = cleanEndpoint.includes('/workflows/') || cleanEndpoint.includes('/outline.');

    let requestBody;
    let headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}` // 1. Header 인증 추가
    };

    if (isWorkflow) {
      // 2. Roboflow Workflow 규격 (Body 내부 api_key 포함)
      requestBody = JSON.stringify({
        api_key: apiKey,
        inputs: {
          image: {
            type: 'url',
            value: formattedBase64Image
          }
        }
      });
    } else {
      // 일반 Inference API 규격
      urlObj.searchParams.set('api_key', apiKey);
      requestBody = JSON.stringify({
        image: {
          type: 'base64',
          value: formattedBase64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '')
        }
      });
    }

    // API 호출
    const targetUrl = isWorkflow ? cleanEndpoint : urlObj.toString();
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: headers,
      body: requestBody
    });

    const resultText = await response.text();

    if (!response.ok) {
      console.error('Roboflow API HTTP Error:', response.status, resultText);
      return res.status(response.status).json({
        error: `Roboflow API 오류 (${response.status})`,
        details: resultText
      });
    }

    const resultData = JSON.parse(resultText);
    return parseAndReturnResult(res, resultData);

  } catch (error) {
    console.error('Predict API Error:', error);
    return res.status(500).json({
      error: '서버 내부 오류가 발생했습니다.',
      message: error.message
    });
  }
}

function parseAndReturnResult(res, resultData) {
  let topClass = 'unknown';
  let confidence = 0.0;

  // 1. Workflow Output 구조 대응
  if (resultData.outputs && Array.isArray(resultData.outputs) && resultData.outputs.length > 0) {
    const firstOutput = resultData.outputs[0];
    // Workflow 내의 다양한 노드 출력 이름 대응
    const predictions = firstOutput.predictions || firstOutput.output?.predictions || firstOutput.predictions?.predictions;
    
    if (predictions && Array.isArray(predictions) && predictions.length > 0) {
      topClass = predictions[0].class || predictions[0].label || predictions[0].top || 'unknown';
      confidence = predictions[0].confidence || predictions[0].score || 0.0;
    } else if (firstOutput.top_class || firstOutput.prediction) {
      topClass = firstOutput.top_class || firstOutput.prediction;
      confidence = firstOutput.confidence || 0.0;
    }
  } 
  // 2. 일반 Model Inference 구조 대응
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
