import $ from 'jquery';
import toastr from 'toastr';
import 'toastr/build/toastr.min.css';
import { requireTavernHelperHost } from './tavernHost';

const runtime = requireTavernHelperHost();
runtime.$ = runtime.$ || $;
runtime.jQuery = runtime.jQuery || $;
runtime.toastr = runtime.toastr || toastr;
