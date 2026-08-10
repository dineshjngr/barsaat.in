<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$payload = json_decode((string) file_get_contents('php://input'), true);
$clientId = is_array($payload) ? (string) ($payload['clientId'] ?? '') : '';
if (!preg_match('/^[a-f0-9]{24,64}$/', $clientId)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid session']);
    exit;
}

$now = time();
$activeWindow = 75;
$presenceFile = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'barsaat-live-presence.json';
$handle = @fopen($presenceFile, 'c+');
if ($handle === false || !flock($handle, LOCK_EX)) {
    if (is_resource($handle)) fclose($handle);
    http_response_code(503);
    echo json_encode(['error' => 'Presence temporarily unavailable']);
    exit;
}

rewind($handle);
$stored = stream_get_contents($handle);
$sessions = is_string($stored) && $stored !== '' ? json_decode($stored, true) : [];
if (!is_array($sessions)) $sessions = [];

$sessions = array_filter($sessions, static fn ($seen): bool => is_int($seen) && $seen >= $now - $activeWindow);
$leaving = isset($_GET['action']) && $_GET['action'] === 'leave';
if ($leaving) unset($sessions[$clientId]);
else $sessions[$clientId] = $now;

rewind($handle);
ftruncate($handle, 0);
fwrite($handle, (string) json_encode($sessions, JSON_UNESCAPED_SLASHES));
fflush($handle);
flock($handle, LOCK_UN);
fclose($handle);

echo json_encode(['count' => count($sessions), 'activeWindow' => $activeWindow]);
