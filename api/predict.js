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

    const apiKey = (process.env.ROBOFLOW_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    let rawEndpoint = (process.env.ROBOFLOW_ENDPOINT || '').trim().replace(/^["']|["']$/g, '');

    if (!apiKey || !rawEndpoint) {
      return res.status(500).json({
        error: 'Vercel 환경변수(ROBOFLOW_API_KEY 또는 ROBOFLOW_ENDPOINT)가 설정되지 않았습니다.'
      });
    }

    const urlObj = new URL(rawEndpoint);
    urlObj.searchParams.delete('api_key');
    const cleanEndpoint = urlObj.toString();

    const formattedBase64Image = image.startsWith('data:') 
      ? image 
      : `data:image/jpeg;base64,${image}`;

    const isWorkflow = cleanEndpoint.includes('/workflows/') || cleanEndpoint.includes('/outline.');

    let requestBody;
    let headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    if (isWorkflow) {
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
      urlObj.searchParams.set('api_key', apiKey);
      requestBody = JSON.stringify({
        image: {
          type: 'base64',
          value: formattedBase64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '')
        }
      });
    }

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
    return parseSmartResult(res, resultData);

  } catch (error) {
    console.error('Predict API Error:', error);
    return res.status(500).json({
      error: '서버 내부 오류가 발생했습니다.',
      message: error.message
    });
  }
}

// Roboflow DINOv3 및 Workflow 결과 스마트 파싱 함수
function parseSmartResult(res, rawData) {
  let detectedClass = 'unknown';
  let confidence = 0.0;

  // JSON 트리 전체를 재귀 탐색하며 예측 정보 추출
  function searchNode(obj) {
    if (!obj || typeof obj !== 'object') return;

    // 1. 객체 내에서 class/label/prediction 및 confidence/score 찾기
    const possibleClass = obj.class || obj.label || obj.prediction || obj.top_class || obj.top;
    const possibleConf = obj.confidence ?? obj.score ?? obj.confidence_score;

    if (possibleClass && typeof possibleClass === 'string' && possibleClass !== 'unknown') {
      const lowerCls = possibleClass.toLowerCase();
      if (lowerCls.includes('rock') || lowerCls.includes('paper') || lowerCls.includes('scissors') || lowerCls.includes('바위') || lowerCls.includes('보') || lowerCls.includes('가위')) {
        detectedClass = lowerCls;
        if (possibleConf !== undefined) {
          confidence = Number(possibleConf);
        }
        return;
      }
    }

    // 2. 배열인 경우 순회
    if (Array.isArray(obj)) {
      for (const item of obj) {
        searchNode(item);
        if (detectedClass !== 'unknown') return;
      }
    } 
    // 3. 객체 키 순회
    else {
      for (const key of Object.keys(obj)) {
        // 이미 찾았으면 중단
        if (detectedClass !== 'unknown') return;
        searchNode(obj[key]);
      }
    }
  }

  searchNode(rawData);

  // 클래스 정규화 (rock, paper, scissors)
  let normalizedClass = 'unknown';
  if (detectedClass.includes('rock') || detectedClass.includes('바위')) normalizedClass = 'rock';
  else if (detectedClass.includes('paper') || detectedClass.includes('보')) normalizedClass = 'paper';
  else if (detectedClass.includes('scissors') || detectedClass.includes('가위')) normalizedClass = 'scissors';

  return res.status(200).json({
    success: true,
    topClass: normalizedClass,
    confidence: confidence,
    raw: rawData // Vercel 개발 도구나 브라우저에서 원본 구조 확인용
  });
}
