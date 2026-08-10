<?php
declare(strict_types=1);
require __DIR__ . '/share-lib.php';

$video = share_video_id();
if ($video === '') {
    header('Location: /', true, 302);
    exit;
}

$seconds = share_seconds();
$rain = share_rain();
$theme = share_theme();
$track = youtube_metadata($video);
$canonical = share_canonical($video, $seconds, $rain, $theme);
$image = BARSAAT_ORIGIN . '/listen/og.php?' . http_build_query([
    'v' => $video,
    'rain' => $rain,
    'theme' => $theme,
], '', '&', PHP_QUERY_RFC3986);

$indexCandidates = [dirname(__DIR__) . '/index.html', dirname(__DIR__, 2) . '/index.html'];
$html = '';
foreach ($indexCandidates as $candidate) {
    if (is_file($candidate)) {
        $html = (string) file_get_contents($candidate);
        break;
    }
}
if ($html === '') {
    http_response_code(500);
    echo 'Monsoon Radio is temporarily unavailable.';
    exit;
}

$title = $track['title'] . ' — बरसात Monsoon Radio';
$description = $track['artist'] . ' · listening in the rain';

function replace_first(string $pattern, string $replacement, string $html): string
{
    return (string) preg_replace_callback($pattern, static fn (array $match): string => $replacement, $html, 1);
}

$html = replace_first('~<html\b[^>]*>~i', '<html lang="en-IN" data-theme="' . html_value($theme) . '">', $html);
$html = replace_first('~<title>.*?</title>~si', '<title>' . html_value($title) . '</title>', $html);
$html = replace_first('~<link\s+rel="canonical"[^>]*>~i', '<link rel="canonical" href="' . html_value($canonical) . '" />', $html);
$html = replace_first('~<meta\s+name="description"[^>]*>~i', '<meta name="description" content="' . html_value($description) . '" />', $html);
$html = replace_first('~<meta\s+property="og:title"[^>]*>~i', '<meta property="og:title" content="' . html_value($title) . '" />', $html);
$html = replace_first('~<meta\s+property="og:description"[^>]*>~i', '<meta property="og:description" content="' . html_value($description) . '" />', $html);
$html = replace_first('~<meta\s+property="og:url"[^>]*>~i', '<meta property="og:url" content="' . html_value($canonical) . '" />', $html);
$html = replace_first('~<meta\s+property="og:image"[^>]*>~i', '<meta property="og:image" content="' . html_value($image) . '" />', $html);
$html = replace_first('~<meta\s+property="og:image:secure_url"[^>]*>~i', '<meta property="og:image:secure_url" content="' . html_value($image) . '" />', $html);
$html = replace_first('~<meta\s+property="og:image:width"[^>]*>~i', '<meta property="og:image:width" content="1200" />', $html);
$html = replace_first('~<meta\s+property="og:image:height"[^>]*>~i', '<meta property="og:image:height" content="630" />', $html);
$html = replace_first('~<meta\s+property="og:image:alt"[^>]*>~i', '<meta property="og:image:alt" content="' . html_value($track['title'] . ' by ' . $track['artist'] . ' on Monsoon Radio') . '" />', $html);
$html = replace_first('~<meta\s+name="twitter:title"[^>]*>~i', '<meta name="twitter:title" content="' . html_value($title) . '" />', $html);
$html = replace_first('~<meta\s+name="twitter:description"[^>]*>~i', '<meta name="twitter:description" content="' . html_value($description) . '" />', $html);
$html = replace_first('~<meta\s+name="twitter:image"[^>]*>~i', '<meta name="twitter:image" content="' . html_value($image) . '" />', $html);
$html = replace_first('~<meta\s+name="twitter:image:alt"[^>]*>~i', '<meta name="twitter:image:alt" content="' . html_value($track['title'] . ' by ' . $track['artist'] . ' on Monsoon Radio') . '" />', $html);

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: public, max-age=300, stale-while-revalidate=3600');
echo $html;
