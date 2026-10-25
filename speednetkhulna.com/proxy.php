// Simple PHP proxy for API requests to Node.js backend
// Place this in the web root (e.g., /srv/office_app/client/dist/proxy.php)

error_reporting(E_ALL);
ini_set('display_errors', 1);

$path = $_GET['path'] ?? '';
if (!$path) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing path']);
    exit;
}

$url = 'http://127.0.0.1:5000/api/' . $path;

// Forward query string
if (!empty($_SERVER['QUERY_STRING'])) {
    $url .= '?' . $_SERVER['QUERY_STRING'];
}

// Get request method
$method = $_SERVER['REQUEST_METHOD'];

// Get headers
$headers = [];
foreach (getallheaders() as $name => $value) {
    if (strtolower($name) === 'host') continue; // Don't forward host
    $headers[] = $name . ': ' . $value;
}

// Get body for POST/PUT/etc.
$body = file_get_contents('php://input');

// Make the request
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
if ($body) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);

if (curl_errno($ch)) {
    http_response_code(503);
    echo json_encode(['error' => 'Backend unavailable', 'details' => curl_error($ch)]);
} else {
    http_response_code($httpCode);
    if ($contentType) {
        header('Content-Type: ' . $contentType);
    }
    echo $response;
}

curl_close($ch);