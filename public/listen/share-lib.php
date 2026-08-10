<?php
declare(strict_types=1);

const BARSAAT_ORIGIN = 'https://barsaat.in';

function share_video_id(): string
{
    $video = (string) ($_GET['v'] ?? '');
    return preg_match('/^[A-Za-z0-9_-]{11}$/', $video) ? $video : '';
}

function share_rain(): string
{
    $rain = strtolower((string) ($_GET['rain'] ?? 'rain'));
    return in_array($rain, ['drizzle', 'rain', 'heavy', 'cloudburst'], true) ? $rain : 'rain';
}

function share_theme(): string
{
    return strtolower((string) ($_GET['theme'] ?? 'night')) === 'day' ? 'day' : 'night';
}

function share_seconds(): int
{
    return max(0, min(86400, (int) ($_GET['t'] ?? 0)));
}

function fetch_remote(string $url): ?string
{
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT => 4,
            CURLOPT_USERAGENT => 'BarsaatShare/1.0',
        ]);
        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        return is_string($body) && $status >= 200 && $status < 300 ? $body : null;
    }

    $context = stream_context_create(['http' => [
        'timeout' => 4,
        'follow_location' => 1,
        'user_agent' => 'BarsaatShare/1.0',
    ]]);
    $body = @file_get_contents($url, false, $context);
    return is_string($body) ? $body : null;
}

function youtube_metadata(string $video): array
{
    $fallback = ['title' => 'A song in the rain', 'artist' => 'Monsoon Radio'];
    if ($video === '') return $fallback;

    $cacheFile = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'barsaat-oembed-' . $video . '.json';
    $body = is_file($cacheFile) && filemtime($cacheFile) > time() - 86400 ? @file_get_contents($cacheFile) : null;

    if (!is_string($body) || $body === '') {
        $watchUrl = 'https://www.youtube.com/watch?v=' . rawurlencode($video);
        $body = fetch_remote('https://www.youtube.com/oembed?url=' . rawurlencode($watchUrl) . '&format=json');
        if (is_string($body)) @file_put_contents($cacheFile, $body, LOCK_EX);
    }

    $data = is_string($body) ? json_decode($body, true) : null;
    if (!is_array($data)) return $fallback;

    return [
        'title' => trim((string) ($data['title'] ?? $fallback['title'])),
        'artist' => trim((string) ($data['author_name'] ?? $fallback['artist'])),
    ];
}

function share_canonical(string $video, int $seconds, string $rain, string $theme): string
{
    return BARSAAT_ORIGIN . '/listen/' . rawurlencode($video) . '?' . http_build_query([
        't' => $seconds,
        'rain' => $rain,
        'theme' => $theme,
    ], '', '&', PHP_QUERY_RFC3986);
}

function html_value(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
