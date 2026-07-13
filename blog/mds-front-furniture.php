<?php
/* MatchDay Stories — newspaper masthead (top bar + giant black nameplate), shown on EVERY page so
 * the "MATCHDAY STORIES" logo always links back home. Injected at wp_body_open (top of <body>,
 * OUTSIDE the ColorMag header) with fully INLINE styles, so it renders regardless of theme markup. */
add_action( 'wp_body_open', function () {
	$date = esc_html( date_i18n( 'Y. m. d' ) );
	$home = esc_url( home_url( '/' ) );
	echo '<div class="mds-masthead" style="background:#1b1b19;width:100%;box-sizing:border-box;padding:12px 0 16px;">'
		. '<div style="max-width:1180px;margin:0 auto;padding:0 22px 8px;display:flex;justify-content:space-between;'
		. 'align-items:center;font-family:\'Playfair Display\',Georgia,serif;font-size:12px;letter-spacing:2px;'
		. 'text-transform:uppercase;color:#8a857b;border-bottom:1px solid rgba(210,204,193,.22);">'
		. '<span>Seoul, KR</span><span>' . $date . '</span></div>'
		. '<div style="text-align:center;padding:10px 3% 0;">'
		. '<a href="' . $home . '" style="text-decoration:none;display:inline-block;'
		. 'font-family:\'Fraunces\',\'Playfair Display\',Georgia,serif;font-optical-sizing:auto;font-weight:900;color:#d2ccc1;'
		. 'font-size:clamp(30px,7vw,92px);line-height:1;letter-spacing:-1px;white-space:nowrap;">'
		. 'MATCHDAY STORIES</a></div>'
		. '</div>';
}, 5 );
