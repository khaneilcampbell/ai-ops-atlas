<?php
// Benjaire Flow: forward your website form from a PHP site.
// Save as contact.php, point your form's action at it, and set two environment
// variables (or load them from a file outside the web root):
//   FLOW_INTAKE_URL = https://YOUR-N8N/webhook/flow-intake
//   FLOW_INTAKE_KEY = your intake_key

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit(json_encode(['ok' => false])); }

function clean_line($v, $max) {
  $v = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$v);
  return mb_substr(trim(preg_replace('/\s+/u', ' ', $v)), 0, $max);
}

// Honeypot: bots fill it, people never see it.
if (clean_line($_POST['website'] ?? '', 200) !== '') { exit(json_encode(['ok' => true])); }

$payload = [
  'name'    => clean_line($_POST['name'] ?? '', 120),
  'email'   => strtolower(clean_line($_POST['email'] ?? '', 200)),
  'company' => clean_line($_POST['company'] ?? '', 160),
  'phone'   => clean_line($_POST['phone'] ?? '', 40),
  'message' => mb_substr(trim((string)($_POST['message'] ?? '')), 0, 5000),
  'source'  => clean_line($_POST['source'] ?? 'website', 40),
  'website' => ''
];

if ($payload['name'] === '' || !filter_var($payload['email'], FILTER_VALIDATE_EMAIL) || mb_strlen($payload['message']) < 10) {
  http_response_code(422);
  exit(json_encode(['ok' => false, 'error' => 'Please include your name, a valid email and a short message.']));
}

$ch = curl_init(getenv('FLOW_INTAKE_URL'));
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 15,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-flow-key: ' . getenv('FLOW_INTAKE_KEY')],
  CURLOPT_POSTFIELDS => json_encode($payload)
]);
curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($status >= 200 && $status < 300) { exit(json_encode(['ok' => true])); }
error_log('Flow intake failed with HTTP ' . $status);
http_response_code($status === 422 ? 422 : 502);
echo json_encode(['ok' => false, 'error' => 'Your message could not be sent. Please email us directly.']);
